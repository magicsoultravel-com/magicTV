# Chromecast manual test checklist

Use Chrome with a Chromecast / Nest Hub on the same network.

- [ ] Cast a live HLS stream — Nest Hub leaves the cast icon / logo and shows video (not stuck on artwork).
- [ ] Failed load shows a specific toast (e.g. stream unreachable / blocked for Chromecast) and **restores host** playback (no stuck paused tile + dead cast session).
- [ ] Streams that block Chromecast CORS still fail honestly (no silent logo-only session).
- [ ] Pause/play from the CAST row — controls are reflected on the TV.
- [ ] CAST stop — the CAST play button switches to play (not pause); play reloads the current channel.
- [ ] Local hover row stays visible while casting (independent of host video). CAST + Local dual rows on the active tile.
- [ ] Cast volume rocker appears on the left of the active cast tile (cast icon above, `%` between ±); local rocker shifts inward.
- [ ] Cast rocker ± changes Nest Hub volume; `%` tracks the receiver; local rocker stays browser-only.
- [ ] Change channel on the active cast tile — the TV switches to the new stream.
- [ ] Toggle host video in the CAST popout — local video pauses/resumes; local controls stay visible (host+target vs target-only).
- [ ] Control the local row independently from the CAST row (local play/stop/mute do not drive the receiver).
- [ ] Disconnect / end cast from the host — local tile does not stay in a loading spinner; play shows play if local is paused.
- [ ] Refresh the page while casting — the app reconnects to the same session and highlights the active tile.
- [ ] Webpage / remote volume slider is local-only; cast volume is the tile cast rocker only.
