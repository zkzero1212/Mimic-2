# Mimic V2 — v0.08g approved concept asset integration

- The approved 2026-11-04 concept is the visual source, not the legacy CSS panels.
- Real 1920×1080 four-frame animated WebP, 660 ms per frame.
- UI texture PNG assets are mounted separately for title, information panel, tool palette, treasure strip, popups, speech bubbles, buttons, badges and status icons.
- Runtime assets are in `assets/ui-v2/`.
- CSS integration is isolated in `css/asset-ui-v0.08g.css`; legacy game logic and SVG deduction links were not modified.
- Existing chest icons remain in `assets/chests/`.
- Special 9×9 dense-board handling continues to dock the toolbar below the board, keeping clue cards interactive.
- The approved concept source was previously resized to 1920×1080. It is not genuinely natively-painted 1920-pixel art.
