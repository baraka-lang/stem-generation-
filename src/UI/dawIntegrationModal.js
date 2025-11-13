/**
 * DAW Integration Help Modal
 * Provides step-by-step instructions for using stems with Ableton Live, Logic Pro, and FL Studio
 */

export function createDawIntegrationModal() {
  const modal = document.createElement('div')
  modal.id = 'dawIntegrationModal'
  modal.className = 'fixed inset-0 z-[9999] hidden'
  modal.style.cssText = 'background: rgba(0,0,0,0.85); opacity: 0; transition: opacity 0.2s;'

  modal.innerHTML = `
    <div class="flex items-center justify-center min-h-screen px-4 py-8">
      <div class="relative w-full max-w-3xl bg-gradient-to-br from-gray-900 to-black border border-white/20 rounded-2xl shadow-2xl transform scale-95 transition-transform duration-200 max-h-[90vh] overflow-hidden flex flex-col">

        <!-- Header -->
        <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between sticky top-0 bg-gray-900/95 backdrop-blur z-10">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <i data-lucide="info" class="w-5 h-5 text-white"></i>
            </div>
            <div>
              <h2 class="text-xl font-bold text-white">DAW Integration Guide</h2>
              <p class="text-xs text-white/60">How to use stems in Ableton Live, Logic Pro & FL Studio</p>
            </div>
          </div>
          <button data-action="close-daw-modal" class="w-8 h-8 rounded-lg hover:bg-white/10 flex items-center justify-center transition text-white/80 hover:text-white">
            <i data-lucide="x" class="w-5 h-5"></i>
          </button>
        </div>

        <!-- Content -->
        <div class="overflow-y-auto flex-1 px-6 py-6">

          <!-- Important Notice -->
          <div class="mb-6 p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
            <div class="flex gap-3">
              <i data-lucide="alert-triangle" class="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5"></i>
              <div>
                <h3 class="font-semibold text-yellow-400 mb-1">Browser Limitation</h3>
                <p class="text-sm text-white/80 leading-relaxed">
                  Due to browser security restrictions, you <strong>cannot drag files directly</strong> from this web app into your DAW.
                  You must first <strong>save files to your computer</strong>, then drag them from your file manager (Finder/Explorer) or from within the DAW's browser.
                </p>
              </div>
            </div>
          </div>

          <!-- Recommended Workflow -->
          <div class="mb-6">
            <h3 class="text-lg font-semibold text-white mb-3 flex items-center gap-2">
              <i data-lucide="workflow" class="w-5 h-5 text-blue-400"></i>
              Recommended Workflow
            </h3>
            <div class="space-y-3">
              <div class="flex gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <div class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center">1</div>
                <div class="flex-1">
                  <p class="text-white font-medium mb-1">Save stems to a dedicated folder</p>
                  <p class="text-sm text-white/70">Click "Save to Folder" and create a folder like "Techno Stems" in your Music directory.</p>
                </div>
              </div>
              <div class="flex gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <div class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center">2</div>
                <div class="flex-1">
                  <p class="text-white font-medium mb-1">Add folder to your DAW's browser</p>
                  <p class="text-sm text-white/70">Configure your DAW to index this folder (instructions below for each DAW).</p>
                </div>
              </div>
              <div class="flex gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                <div class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white text-sm font-bold flex items-center justify-center">3</div>
                <div class="flex-1">
                  <p class="text-white font-medium mb-1">Drag from DAW browser or Finder/Explorer</p>
                  <p class="text-sm text-white/70">Now you can drag stems directly from your DAW's browser or file manager into tracks.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- DAW-Specific Instructions -->
          <div class="space-y-4">

            <!-- Ableton Live -->
            <div class="border border-white/10 rounded-lg overflow-hidden">
              <button data-action="toggle-daw-section" data-daw="ableton" class="w-full px-4 py-3 bg-white/5 hover:bg-white/10 transition flex items-center justify-between text-left">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                    <i data-lucide="music" class="w-4 h-4 text-white"></i>
                  </div>
                  <span class="font-semibold text-white">Ableton Live</span>
                </div>
                <i data-lucide="chevron-down" class="w-5 h-5 text-white/60 transition-transform" data-chevron="ableton"></i>
              </button>
              <div data-daw-content="ableton" class="hidden px-4 py-3 bg-black/20 space-y-2 text-sm text-white/80">
                <p class="font-medium text-white mb-2">Setup Instructions:</p>
                <ol class="list-decimal list-inside space-y-2 ml-2">
                  <li>In Ableton Live, look at the <strong>Browser</strong> panel (usually on the left)</li>
                  <li>Find the <strong>"Places"</strong> section at the top of the Browser</li>
                  <li>Click <strong>"Add Folder"</strong> (or drag a folder into Places)</li>
                  <li>Navigate to your "Techno Stems" folder and select it</li>
                  <li>The folder will now appear in Places - click it to browse your stems</li>
                  <li>Drag stems from the Browser directly onto audio tracks or the Session/Arrangement view</li>
                </ol>
                <div class="mt-3 p-3 rounded bg-blue-500/10 border border-blue-500/30">
                  <p class="text-xs text-blue-300"><strong>Pro Tip:</strong> Stems are named with BPM and key info. Enable "Warp" on audio clips to time-stretch them to match your project tempo.</p>
                </div>
              </div>
            </div>

            <!-- Logic Pro -->
            <div class="border border-white/10 rounded-lg overflow-hidden">
              <button data-action="toggle-daw-section" data-daw="logic" class="w-full px-4 py-3 bg-white/5 hover:bg-white/10 transition flex items-center justify-between text-left">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded bg-gradient-to-br from-gray-600 to-gray-800 flex items-center justify-center">
                    <i data-lucide="music-2" class="w-4 h-4 text-white"></i>
                  </div>
                  <span class="font-semibold text-white">Logic Pro</span>
                </div>
                <i data-lucide="chevron-down" class="w-5 h-5 text-white/60 transition-transform" data-chevron="logic"></i>
              </button>
              <div data-daw-content="logic" class="hidden px-4 py-3 bg-black/20 space-y-2 text-sm text-white/80">
                <p class="font-medium text-white mb-2">Setup Instructions:</p>
                <ol class="list-decimal list-inside space-y-2 ml-2">
                  <li>Open <strong>Finder</strong> and navigate to your "Techno Stems" folder</li>
                  <li>Keep Finder window visible alongside Logic Pro</li>
                  <li>Drag WAV files directly from Finder into the <strong>Tracks area</strong></li>
                  <li>Logic will automatically create audio tracks or sampler tracks</li>
                  <li>Alternatively, use Logic's <strong>Browser</strong> (press 'F' key) and navigate to your stems folder</li>
                </ol>
                <div class="mt-3 p-3 rounded bg-blue-500/10 border border-blue-500/30">
                  <p class="text-xs text-blue-300"><strong>Pro Tip:</strong> Logic's Flex Time feature will automatically detect tempo. Enable it in the Track Header for seamless tempo matching.</p>
                </div>
              </div>
            </div>

            <!-- FL Studio -->
            <div class="border border-white/10 rounded-lg overflow-hidden">
              <button data-action="toggle-daw-section" data-daw="fl" class="w-full px-4 py-3 bg-white/5 hover:bg-white/10 transition flex items-center justify-between text-left">
                <div class="flex items-center gap-3">
                  <div class="w-8 h-8 rounded bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center">
                    <i data-lucide="disc-3" class="w-4 h-4 text-white"></i>
                  </div>
                  <span class="font-semibold text-white">FL Studio</span>
                </div>
                <i data-lucide="chevron-down" class="w-5 h-5 text-white/60 transition-transform" data-chevron="fl"></i>
              </button>
              <div data-daw-content="fl" class="hidden px-4 py-3 bg-black/20 space-y-2 text-sm text-white/80">
                <p class="font-medium text-white mb-2">Setup Instructions:</p>
                <ol class="list-decimal list-inside space-y-2 ml-2">
                  <li>In FL Studio, open the <strong>Browser</strong> panel</li>
                  <li>Click the <strong>folder icon</strong> at the top of the Browser</li>
                  <li>Select <strong>"Add folder to Browser"</strong></li>
                  <li>Navigate to your "Techno Stems" folder and add it</li>
                  <li>The folder will appear in the Browser's file tree</li>
                  <li>Drag stems from the Browser to the <strong>Playlist</strong> or <strong>Channel Rack</strong></li>
                </ol>
                <div class="mt-3 p-3 rounded bg-blue-500/10 border border-blue-500/30">
                  <p class="text-xs text-blue-300"><strong>Pro Tip:</strong> Right-click a sample in the Playlist and choose "Fit to tempo" to automatically time-stretch stems to match your project BPM.</p>
                </div>
              </div>
            </div>

          </div>

          <!-- Troubleshooting -->
          <div class="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <h3 class="font-semibold text-red-400 mb-2 flex items-center gap-2">
              <i data-lucide="help-circle" class="w-4 h-4"></i>
              Common Issues
            </h3>
            <div class="space-y-2 text-sm text-white/80">
              <div>
                <p class="font-medium text-white">Can't drag from browser to DAW?</p>
                <p class="text-xs">Save files to disk first using "Save to Folder", then drag from Finder/Explorer or your DAW's browser.</p>
              </div>
              <div>
                <p class="font-medium text-white">Stems play at wrong tempo?</p>
                <p class="text-xs">Enable time-stretching/warping in your DAW. Stems are named with their original BPM for reference.</p>
              </div>
              <div>
                <p class="font-medium text-white">File won't import?</p>
                <p class="text-xs">Ensure you saved the file with the .wav extension. All stems are standard 16-bit PCM WAV format.</p>
              </div>
            </div>
          </div>

        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-white/10 bg-gray-900/95 backdrop-blur">
          <button data-action="close-daw-modal" class="w-full py-3 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-semibold shadow-lg transition">
            Got it!
          </button>
        </div>

      </div>
    </div>
  `

  return modal
}

export function openDawIntegrationModal() {
  const modal = document.getElementById('dawIntegrationModal')
  if (!modal) return

  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    modal.style.opacity = '1'
    const content = modal.querySelector('.transform')
    if (content) {
      content.classList.remove('scale-95')
      content.classList.add('scale-100')
    }
  })

  // Re-initialize Lucide icons in the modal
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons()
  }
}

export function closeDawIntegrationModal() {
  const modal = document.getElementById('dawIntegrationModal')
  if (!modal) return

  modal.style.opacity = '0'
  const content = modal.querySelector('.transform')
  if (content) {
    content.classList.remove('scale-100')
    content.classList.add('scale-95')
  }

  setTimeout(() => {
    modal.classList.add('hidden')
  }, 200)
}

export function setupDawModalEventListeners() {
  document.addEventListener('click', e => {
    const closeBtn = e.target.closest('[data-action="close-daw-modal"]')
    if (closeBtn) {
      closeDawIntegrationModal()
      return
    }

    const toggleBtn = e.target.closest('[data-action="toggle-daw-section"]')
    if (toggleBtn) {
      const daw = toggleBtn.dataset.daw
      const content = document.querySelector(`[data-daw-content="${daw}"]`)
      const chevron = document.querySelector(`[data-chevron="${daw}"]`)

      if (content && chevron) {
        const isHidden = content.classList.contains('hidden')

        if (isHidden) {
          content.classList.remove('hidden')
          chevron.style.transform = 'rotate(180deg)'
        } else {
          content.classList.add('hidden')
          chevron.style.transform = 'rotate(0deg)'
        }
      }
      return
    }

    if (e.target.id === 'dawIntegrationModal') {
      closeDawIntegrationModal()
    }
  })
}
