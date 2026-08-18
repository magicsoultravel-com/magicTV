# Chromecast manual test checklist

Use Chrome with a Chromecast on the same network.

- [ ] Cast a live HLS stream — verify it loads on the TV.
- [ ] Pause/play from the CAST row — controls are reflected on the TV.
- [ ] CAST stop — the CAST play button switches to play (not pause); play reloads the current channel.
- [ ] Local hover row stays visible while casting (independent of host video). CAST + Local dual rows on the active tile.
- [ ] Change to another tile — the TV switches to the new stream.
- [ ] Toggle host video in the CAST popout — local video pauses/resumes; local controls stay visible.
- [ ] Control the local row independently from the CAST row (local play/stop/mute do not drive the receiver).
- [ ] Disconnect / end cast from the host — local tile does not stay in a loading spinner; play shows play if local is paused.
- [ ] Refresh the page while casting — the app reconnects to the same session and highlights the active tile.
- [ ] Webpage volume slider is local-only; CAST ± volume buttons change the TV.
