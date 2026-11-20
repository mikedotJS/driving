# Pages de mise au point

Pages autonomes pour vérifier visuellement un module isolé (`npx vite` puis
`http://localhost:5173/dev/<page>.html`). Capture sans écran :

    node tools/shot.cjs http://localhost:5173/dev/<page>.html sortie.png 1280 720 1500

La page doit poser `window.__ready = true` quand son rendu est prêt.
