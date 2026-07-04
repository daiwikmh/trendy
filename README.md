# trendy

Point an AI agent at a real browser and watch it click, scroll, screenshot, and
send the fashion looks worth knowing straight to Telegram — by voice or by typing.

The fashion scout browses an editorial site, decides what's a genuinely
striking/on-topic design, screenshots it, and sends it to Telegram.

The UI lives in `trendy/app/` (Next.js); the agent and voice layer live in `src/`
(a plain Node/Express + WebSocket backend). They're two separate processes.

Voice or typed requests from the UI are parsed into a scout request and run through
the fashion agent live — a real, visible browser opens on your machine and you watch
it work while the UI streams status and captures over the WebSocket.


## Every run leaves an audit trail
`data/captures/<timestamp>/` — one screenshot per capture + `captures.json`.
