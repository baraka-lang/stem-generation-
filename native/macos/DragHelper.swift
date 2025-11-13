/**
 * macOS Native Drag Helper for DAW Integration
 *
 * This module implements NSFilePromiseProvider-based dragging to enable
 * direct drag-and-drop from the app to DAWs like Ableton Live, Logic Pro, etc.
 *
 * Unlike browser-based drag APIs, this creates true OS-level file promises
 * that DAWs recognize as audio files.
 */

import Foundation
import AppKit

/**
 * Metadata for a stem being dragged
 */
struct StemDragData {
    let stemId: String
    let pcmData: Data
    let sampleRate: Int
    let numChannels: Int
    let filename: String
}

/**
 * File promise provider delegate that fulfills WAV file promises
 */
class WAVFilePromiseDelegate: NSObject, NSFilePromiseProviderDelegate {
    var stemData: [StemDragData] = []

    func filePromiseProvider(
        _ filePromiseProvider: NSFilePromiseProvider,
        fileNameForType fileType: String
    ) -> String {
        if let stem = filePromiseProvider.userInfo as? StemDragData {
            return stem.filename
        }
        return "audio.wav"
    }

    func filePromiseProvider(
        _ filePromiseProvider: NSFilePromiseProvider,
        writePromiseTo url: URL,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let stem = filePromiseProvider.userInfo as? StemDragData else {
            completionHandler(NSError(
                domain: "DragHelper",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Missing stem data"]
            ))
            return
        }

        do {
            let wavData = try wrapPCMToWAV(
                pcmData: stem.pcmData,
                sampleRate: stem.sampleRate,
                numChannels: stem.numChannels
            )
            try wavData.write(to: url)
            completionHandler(nil)
        } catch {
            completionHandler(error)
        }
    }

    /**
     * Wrap raw PCM S16LE data into WAV format with proper RIFF headers
     */
    private func wrapPCMToWAV(
        pcmData: Data,
        sampleRate: Int,
        numChannels: Int
    ) throws -> Data {
        let bitsPerSample = 16
        let blockAlign = numChannels * (bitsPerSample / 8)
        let byteRate = sampleRate * blockAlign
        let dataSize = pcmData.count

        var wavData = Data(capacity: 44 + dataSize)

        func writeString(_ str: String) {
            wavData.append(contentsOf: str.utf8)
        }

        func writeUInt32LE(_ value: UInt32) {
            wavData.append(UInt8(value & 0xFF))
            wavData.append(UInt8((value >> 8) & 0xFF))
            wavData.append(UInt8((value >> 16) & 0xFF))
            wavData.append(UInt8((value >> 24) & 0xFF))
        }

        func writeUInt16LE(_ value: UInt16) {
            wavData.append(UInt8(value & 0xFF))
            wavData.append(UInt8((value >> 8) & 0xFF))
        }

        writeString("RIFF")
        writeUInt32LE(UInt32(36 + dataSize))
        writeString("WAVE")

        writeString("fmt ")
        writeUInt32LE(16)
        writeUInt16LE(1)
        writeUInt16LE(UInt16(numChannels))
        writeUInt32LE(UInt32(sampleRate))
        writeUInt32LE(UInt32(byteRate))
        writeUInt16LE(UInt16(blockAlign))
        writeUInt16LE(UInt16(bitsPerSample))

        writeString("data")
        writeUInt32LE(UInt32(dataSize))

        wavData.append(pcmData)

        return wavData
    }
}

/**
 * Main drag helper class
 */
@objc
class DragHelper: NSObject {
    static let shared = DragHelper()
    private let delegate = WAVFilePromiseDelegate()

    /**
     * Initiate a native drag operation with file promises
     *
     * @param stems: Array of stem data to drag
     * @param view: The view to start the drag from
     * @param event: The mouse event that triggered the drag
     * @return: True if drag was initiated successfully
     */
    @objc
    func startNativeDrag(
        stems: [[String: Any]],
        fromView view: NSView,
        withEvent event: NSEvent
    ) -> Bool {
        var draggingItems: [NSDraggingItem] = []

        for stemDict in stems {
            guard
                let stemId = stemDict["stemId"] as? String,
                let pcmDataArray = stemDict["pcmData"] as? [UInt8],
                let sampleRate = stemDict["sampleRate"] as? Int,
                let numChannels = stemDict["numChannels"] as? Int,
                let filename = stemDict["filename"] as? String
            else {
                continue
            }

            let pcmData = Data(pcmDataArray)
            let stemData = StemDragData(
                stemId: stemId,
                pcmData: pcmData,
                sampleRate: sampleRate,
                numChannels: numChannels,
                filename: filename
            )

            let provider = NSFilePromiseProvider(
                fileType: "com.microsoft.waveform-audio",
                delegate: delegate
            )
            provider.userInfo = stemData

            let draggingItem = NSDraggingItem(pasteboardWriter: provider)
            draggingItem.setDraggingFrame(
                NSRect(x: 0, y: 0, width: 100, height: 100),
                contents: nil
            )

            draggingItems.append(draggingItem)
        }

        guard !draggingItems.isEmpty else {
            return false
        }

        let draggingSession = view.beginDraggingSession(
            with: draggingItems,
            event: event,
            source: self
        )

        return draggingSession != nil
    }
}

extension DragHelper: NSDraggingSource {
    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        return .copy
    }
}
