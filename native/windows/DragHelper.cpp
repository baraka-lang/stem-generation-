/**
 * Windows Native Drag Helper for DAW Integration
 *
 * This module implements virtual file dragging using CFSTR_FILEDESCRIPTOR
 * and CFSTR_FILECONTENTS to enable direct drag-and-drop from the app to
 * DAWs like Ableton Live, FL Studio, etc.
 *
 * Unlike browser-based drag APIs, this creates true OS-level virtual files
 * that DAWs recognize as audio files.
 */

#include <windows.h>
#include <shlobj.h>
#include <ole2.h>
#include <vector>
#include <string>
#include <memory>

struct StemData {
    std::string stemId;
    std::vector<uint8_t> pcmData;
    int sampleRate;
    int numChannels;
    std::string filename;
};

class WavStreamProvider : public IStream {
private:
    ULONG refCount;
    std::vector<uint8_t> wavData;
    ULONGLONG position;

public:
    WavStreamProvider(const std::vector<uint8_t>& pcm, int sampleRate, int channels, const std::string& filename)
        : refCount(1), position(0) {
        wavData = createWavFromPCM(pcm, sampleRate, channels);
    }

    // IUnknown methods
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (riid == IID_IUnknown || riid == IID_IStream || riid == IID_ISequentialStream) {
            *ppv = static_cast<IStream*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() {
        return InterlockedIncrement(&refCount);
    }

    STDMETHODIMP_(ULONG) Release() {
        ULONG count = InterlockedDecrement(&refCount);
        if (count == 0) {
            delete this;
        }
        return count;
    }

    // ISequentialStream methods
    STDMETHODIMP Read(void* pv, ULONG cb, ULONG* pcbRead) {
        if (!pv) return STG_E_INVALIDPOINTER;

        ULONG bytesToRead = min(cb, (ULONG)(wavData.size() - position));
        if (bytesToRead > 0) {
            memcpy(pv, wavData.data() + position, bytesToRead);
            position += bytesToRead;
        }

        if (pcbRead) *pcbRead = bytesToRead;
        return (bytesToRead < cb) ? S_FALSE : S_OK;
    }

    STDMETHODIMP Write(const void* pv, ULONG cb, ULONG* pcbWritten) {
        return STG_E_ACCESSDENIED;
    }

    // IStream methods
    STDMETHODIMP Seek(LARGE_INTEGER dlibMove, DWORD dwOrigin, ULARGE_INTEGER* plibNewPosition) {
        LONGLONG newPos = position;

        switch (dwOrigin) {
            case STREAM_SEEK_SET:
                newPos = dlibMove.QuadPart;
                break;
            case STREAM_SEEK_CUR:
                newPos += dlibMove.QuadPart;
                break;
            case STREAM_SEEK_END:
                newPos = wavData.size() + dlibMove.QuadPart;
                break;
            default:
                return STG_E_INVALIDFUNCTION;
        }

        if (newPos < 0 || newPos > (LONGLONG)wavData.size()) {
            return STG_E_INVALIDFUNCTION;
        }

        position = (ULONGLONG)newPos;
        if (plibNewPosition) {
            plibNewPosition->QuadPart = position;
        }

        return S_OK;
    }

    STDMETHODIMP SetSize(ULARGE_INTEGER libNewSize) {
        return STG_E_ACCESSDENIED;
    }

    STDMETHODIMP CopyTo(IStream* pstm, ULARGE_INTEGER cb, ULARGE_INTEGER* pcbRead, ULARGE_INTEGER* pcbWritten) {
        return E_NOTIMPL;
    }

    STDMETHODIMP Commit(DWORD grfCommitFlags) {
        return S_OK;
    }

    STDMETHODIMP Revert() {
        return E_NOTIMPL;
    }

    STDMETHODIMP LockRegion(ULARGE_INTEGER libOffset, ULARGE_INTEGER cb, DWORD dwLockType) {
        return STG_E_INVALIDFUNCTION;
    }

    STDMETHODIMP UnlockRegion(ULARGE_INTEGER libOffset, ULARGE_INTEGER cb, DWORD dwLockType) {
        return STG_E_INVALIDFUNCTION;
    }

    STDMETHODIMP Stat(STATSTG* pstatstg, DWORD grfStatFlag) {
        if (!pstatstg) return STG_E_INVALIDPOINTER;

        ZeroMemory(pstatstg, sizeof(STATSTG));
        pstatstg->type = STGTY_STREAM;
        pstatstg->cbSize.QuadPart = wavData.size();

        return S_OK;
    }

    STDMETHODIMP Clone(IStream** ppstm) {
        return E_NOTIMPL;
    }

private:
    std::vector<uint8_t> createWavFromPCM(const std::vector<uint8_t>& pcm, int sampleRate, int channels) {
        int bitsPerSample = 16;
        int blockAlign = channels * (bitsPerSample / 8);
        int byteRate = sampleRate * blockAlign;
        int dataSize = pcm.size();

        std::vector<uint8_t> wav;
        wav.reserve(44 + dataSize);

        auto writeString = [&](const char* str) {
            while (*str) wav.push_back(*str++);
        };

        auto writeUInt32LE = [&](uint32_t val) {
            wav.push_back(val & 0xFF);
            wav.push_back((val >> 8) & 0xFF);
            wav.push_back((val >> 16) & 0xFF);
            wav.push_back((val >> 24) & 0xFF);
        };

        auto writeUInt16LE = [&](uint16_t val) {
            wav.push_back(val & 0xFF);
            wav.push_back((val >> 8) & 0xFF);
        };

        writeString("RIFF");
        writeUInt32LE(36 + dataSize);
        writeString("WAVE");

        writeString("fmt ");
        writeUInt32LE(16);
        writeUInt16LE(1);
        writeUInt16LE(channels);
        writeUInt32LE(sampleRate);
        writeUInt32LE(byteRate);
        writeUInt16LE(blockAlign);
        writeUInt16LE(bitsPerSample);

        writeString("data");
        writeUInt32LE(dataSize);

        wav.insert(wav.end(), pcm.begin(), pcm.end());

        return wav;
    }
};

class VirtualFileDataObject : public IDataObject {
private:
    ULONG refCount;
    std::vector<StemData> stems;
    std::vector<std::unique_ptr<WavStreamProvider>> streams;

public:
    VirtualFileDataObject(const std::vector<StemData>& stemList)
        : refCount(1), stems(stemList) {
    }

    // IUnknown methods
    STDMETHODIMP QueryInterface(REFIID riid, void** ppv) {
        if (riid == IID_IUnknown || riid == IID_IDataObject) {
            *ppv = static_cast<IDataObject*>(this);
            AddRef();
            return S_OK;
        }
        *ppv = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHODIMP_(ULONG) AddRef() {
        return InterlockedIncrement(&refCount);
    }

    STDMETHODIMP_(ULONG) Release() {
        ULONG count = InterlockedDecrement(&refCount);
        if (count == 0) {
            delete this;
        }
        return count;
    }

    // IDataObject methods
    STDMETHODIMP GetData(FORMATETC* pformatetc, STGMEDIUM* pmedium) {
        if (!pformatetc || !pmedium) return E_INVALIDARG;

        UINT cfFileDescriptor = RegisterClipboardFormat(CFSTR_FILEDESCRIPTORW);
        UINT cfFileContents = RegisterClipboardFormat(CFSTR_FILECONTENTS);

        if (pformatetc->cfFormat == cfFileDescriptor &&
            pformatetc->tymed & TYMED_HGLOBAL) {

            SIZE_T size = sizeof(FILEGROUPDESCRIPTORW) + (stems.size() - 1) * sizeof(FILEDESCRIPTORW);
            HGLOBAL hGlobal = GlobalAlloc(GMEM_MOVEABLE, size);
            if (!hGlobal) return E_OUTOFMEMORY;

            FILEGROUPDESCRIPTORW* fgd = (FILEGROUPDESCRIPTORW*)GlobalLock(hGlobal);
            fgd->cItems = stems.size();

            for (size_t i = 0; i < stems.size(); i++) {
                FILEDESCRIPTORW& fd = fgd->fgd[i];
                ZeroMemory(&fd, sizeof(FILEDESCRIPTORW));

                std::wstring wFilename(stems[i].filename.begin(), stems[i].filename.end());
                wcsncpy_s(fd.cFileName, MAX_PATH, wFilename.c_str(), _TRUNCATE);

                fd.dwFlags = FD_FILESIZE;
                int wavSize = 44 + stems[i].pcmData.size();
                fd.nFileSizeLow = wavSize;
                fd.nFileSizeHigh = 0;
            }

            GlobalUnlock(hGlobal);

            pmedium->tymed = TYMED_HGLOBAL;
            pmedium->hGlobal = hGlobal;
            pmedium->pUnkForRelease = nullptr;

            return S_OK;
        }

        if (pformatetc->cfFormat == cfFileContents &&
            pformatetc->tymed & TYMED_ISTREAM &&
            pformatetc->lindex >= 0 && pformatetc->lindex < (LONG)stems.size()) {

            const StemData& stem = stems[pformatetc->lindex];
            WavStreamProvider* stream = new WavStreamProvider(
                stem.pcmData,
                stem.sampleRate,
                stem.numChannels,
                stem.filename
            );

            pmedium->tymed = TYMED_ISTREAM;
            pmedium->pstm = stream;
            pmedium->pUnkForRelease = nullptr;

            return S_OK;
        }

        return DV_E_FORMATETC;
    }

    STDMETHODIMP GetDataHere(FORMATETC* pformatetc, STGMEDIUM* pmedium) {
        return E_NOTIMPL;
    }

    STDMETHODIMP QueryGetData(FORMATETC* pformatetc) {
        if (!pformatetc) return E_INVALIDARG;

        UINT cfFileDescriptor = RegisterClipboardFormat(CFSTR_FILEDESCRIPTORW);
        UINT cfFileContents = RegisterClipboardFormat(CFSTR_FILECONTENTS);

        if (pformatetc->cfFormat == cfFileDescriptor && pformatetc->tymed & TYMED_HGLOBAL) {
            return S_OK;
        }

        if (pformatetc->cfFormat == cfFileContents && pformatetc->tymed & TYMED_ISTREAM) {
            return S_OK;
        }

        return DV_E_FORMATETC;
    }

    STDMETHODIMP GetCanonicalFormatEtc(FORMATETC* pformatectIn, FORMATETC* pformatetcOut) {
        return E_NOTIMPL;
    }

    STDMETHODIMP SetData(FORMATETC* pformatetc, STGMEDIUM* pmedium, BOOL fRelease) {
        return E_NOTIMPL;
    }

    STDMETHODIMP EnumFormatEtc(DWORD dwDirection, IEnumFORMATETC** ppenumFormatEtc) {
        return E_NOTIMPL;
    }

    STDMETHODIMP DAdvise(FORMATETC* pformatetc, DWORD advf, IAdviseSink* pAdvSink, DWORD* pdwConnection) {
        return OLE_E_ADVISENOTSUPPORTED;
    }

    STDMETHODIMP DUnadvise(DWORD dwConnection) {
        return OLE_E_ADVISENOTSUPPORTED;
    }

    STDMETHODIMP EnumDAdvise(IEnumSTATDATA** ppenumAdvise) {
        return OLE_E_ADVISENOTSUPPORTED;
    }
};

extern "C" {
    __declspec(dllexport) bool StartNativeDrag(HWND hwnd, const std::vector<StemData>& stems) {
        if (stems.empty()) return false;

        VirtualFileDataObject* dataObj = new VirtualFileDataObject(stems);
        IDropSource* dropSource = nullptr;

        HRESULT hr = SHCreateStdObject(nullptr, nullptr, IID_IDropSource, (void**)&dropSource);
        if (FAILED(hr)) {
            dataObj->Release();
            return false;
        }

        DWORD effect;
        hr = DoDragDrop(dataObj, dropSource, DROPEFFECT_COPY, &effect);

        dropSource->Release();
        dataObj->Release();

        return SUCCEEDED(hr);
    }
}
