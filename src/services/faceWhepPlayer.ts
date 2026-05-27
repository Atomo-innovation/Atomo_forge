/**
 * Minimal WHEP client (same flow as live_stream/public/index.html).
 */
export type FaceWhepConnection = {
  close: () => void;
};

export async function connectFaceWhep(
  whepUrl: string,
  videoEl: HTMLVideoElement,
): Promise<FaceWhepConnection> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  pc.ontrack = (ev) => {
    if (ev.streams?.[0]) {
      videoEl.srcObject = ev.streams[0];
      void videoEl.play().catch(() => null);
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const onChange = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    setTimeout(resolve, 3000);
  });

  const resp = await fetch(whepUrl, {
    method: "POST",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? "",
  });

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    pc.close();
    throw new Error(`WHEP ${resp.status}${txt ? `: ${txt}` : ""}`);
  }

  const answerSdp = await resp.text();
  await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

  return {
    close: () => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      if (videoEl.srcObject) {
        const stream = videoEl.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoEl.srcObject = null;
      }
    },
  };
}
