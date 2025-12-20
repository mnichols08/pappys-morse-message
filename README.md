# Morse Web App (Vanilla + Web Components + Web Audio)

## Run locally
Because Web Audio + modules can be blocked from file://, run a tiny local server:

### Python
python -m http.server 8000

Then open: http://localhost:8000/morse-webapp/

## Background image
Put your festive card image at:
morse-webapp/images/festive-card.png

(or change the `background-src` attribute in index.html)

## Message
The morse string is embedded in index.html in the <morse-player morse="..."> attribute.
