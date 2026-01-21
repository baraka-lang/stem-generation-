// Extracted help modal setup from app.js
export function setupHelpModal(){
  const helpBtn = document.getElementById('helpBtn')
  const helpModal = document.getElementById('helpModal')
  const overlay = document.getElementById('helpModalOverlay')
  const closeBtn = document.getElementById('helpModalCloseBtn')
  if (!helpModal) return
  function openModal(){
    helpModal.classList.remove('hidden')
    requestAnimationFrame(() => {
      helpModal.style.opacity = '1'
    })
    document.body.style.overflow = 'hidden'
  }
  function closeModal(){
    helpModal.style.opacity = '0'
    setTimeout(() => {
      helpModal.classList.add('hidden')
      document.body.style.overflow = ''
    }, 300)
  }
  if (helpBtn) helpBtn.addEventListener('click', openModal)
  if (overlay) overlay.addEventListener('click', closeModal)
  if (closeBtn) closeBtn.addEventListener('click', closeModal)
}


