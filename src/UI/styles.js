// Extracted global style injection from app.js
export function injectGlobalStyles() {
  if (document.getElementById('sg-global-styles')) return
  const style = document.createElement('style')
  style.id = 'sg-global-styles'
  style.textContent =
    `@keyframes soft-pulse-glow {\n      0%, 100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.28), 0 0 16px rgba(255,255,255,0.12); transform: translateY(0) scale(1); }\n      50%      { box-shadow: 0 0 0 12px rgba(255,255,255,0), 0 0 22px rgba(255,255,255,0.22); transform: translateY(-0.5px) scale(1.012); }\n    }\n    #playBtn { animation: soft-pulse-glow 2.6s ease-in-out infinite; transition: transform 160ms ease, box-shadow 160ms ease; will-change: transform, box-shadow; }\n    #playBtn:hover { transform: translateY(-1px) scale(1.02); }\n    #playBtn:active { transform: translateY(0); }\n    .sg-mix-card.sg-glow { animation: soft-pulse-glow 2.6s ease-in-out infinite; }\n    .sg-toggle-active { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.35); }`;
  document.head.appendChild(style)
}


