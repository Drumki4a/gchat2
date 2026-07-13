import { useState, useEffect, useRef, useCallback, useMemo } from '"'"'react'"'"';
import { io } from '"'"'socket.io-client'"'"';

// ── Config ────────────────────────────────────────────────────────────────
const SERVER_URL = import.meta.env.VITE_SERVER_URL || '"'"'http://localhost:3001'"'"';
const ICE_SERVERS = [
  { urls: '"'"'stun:stun.l.google.com:19302'"'"' },
  { urls: '"'"'stun:stun1.l.google.com:19302'"'"' },
];

// ── Interest tags ──────────────────────────────────────────────────────────
const ALL_TAGS = [
  '"'"'Gaming'"'"', '"'"'Music'"'"', '"'"'Art'"'"', '"'"'Tech'"'"', '"'"'Travel'"'"',
  '"'"'Fitness'"'"', '"'"'Food'"'"', '"'"'Movies'"'"', '"'"'Books'"'"', '"'"'Fashion'"'"',
  '"'"'Photography'"'"', '"'"'Crypto'"'"', '"'"'Sports'"'"', '"'"'Fashion'"'"', '"'"'Coding'"'"',
  '"'"'Comedy'"'"', '"'"'Nature'"'"', '"'"'Anime'"'"', '"'"'Dance'"'"', '"'"'DIY'"'"',
];

// ── Socket singleton ────────────────────────────────────────────────────────
let socket = null;
function getSocket() {
  if (!socket) {
    socket = io(SERVER_URL, { transports: ['"'"'websocket'"'"', '"'"'polling'"'"'] });
  }
  return socket;
}

// ── PARTICLE CANVAS ────────────────────────────────────────────────────────
function Particles() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const particlesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('"'"'2d'"'"');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    const createParticle = () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 2 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.1,
      color: ['"'"'rgba(168,85,247,'"'"', '"'"'rgba(99,102,241,'"'"', '"'"'rgba(236,72,153,'"'"'][Math.floor(Math.random() * 3)],
    });

    particlesRef.current = Array.from({ length: 60 }, createParticle);

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + p.alpha + ')"'"';
        ctx.fill();
      });
      animRef.current = requestAnimationFrame(draw);
    };

    const onResize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };

    window.addEventListener('"'"'resize'"'"', onResize);
    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('"'"'resize'"'"', onResize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} id='"'"'particles'"'"' style={{
      position: '"'"'fixed'"'"', inset: 0, pointerEvents: '"'"'none'"'"', zIndex: 1
    }} />
  );
}

// ── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState('"'"'LANDING'"'"');
  const [selectedTags, setSelectedTags] = useState([]);
  const [partnerId, setPartnerId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('"'"''"'"');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState('"'"''"'"');
  const [filter, setFilter] = useState('"'"'none'"'"');
  const [showGlitch, setShowGlitch] = useState(false);
  const [showMatch, setShowMatch] = useState(false);

  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const dataChannelRef = useRef(null);
  const glitchTimerRef = useRef(null);
  const matchTimerRef = useRef(null);

  // ── Toggle tag ──────────────────────────────────────────────────────────
  const toggleTag = (tag) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  // ── Camera ──────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: '"'"'user'"'"' },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });
      return stream;
    } catch {
      setError('"'"'Camera/mic access denied.'"'"');
      return null;
    }
  }, [isMuted, isVideoOff]);

  // ── Peer connection ─────────────────────────────────────────────────────
  const createPeerConnection = useCallback((targetId, isInitiator) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) getSocket().emit('"'"'signal_ice'"'"', { targetId, candidate });
    };

    pc.ontrack = ({ streams }) => {
      if (remoteVideoRef.current && streams[0]) remoteVideoRef.current.srcObject = streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (['"'"'failed'"'"', '"'"'disconnected'"'"'].includes(pc.connectionState)) handlePartnerLeft();
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('"'"'chat'"'"');
      dc.onmessage = ({ data }) => {
        try {
          const { text } = JSON.parse(data);
          setMessages(prev => [...prev, { text, type: '"'"'received'"'"' }]);
        } catch {}
      };
      dataChannelRef.current = dc;
    } else {
      pc.ondatachannel = ({ channel }) => {
        channel.onmessage = ({ data }) => {
          try {
            const { text } = JSON.parse(data);
            setMessages(prev => [...prev, { text, type: '"'"'received'"'"' }]);
          } catch {}
        };
        dataChannelRef.current = channel;
      };
    }

    return pc;
  }, []);

  const cleanupCall = useCallback(() => {
    dataChannelRef.current = null;
    if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setMessages([]);
    setFilter('"'"'none'"'"');
  }, []);

  const handlePartnerLeft = useCallback(() => {
    cleanupCall();
    setPhase('"'"'ENDED'"'"');
  }, [cleanupCall]);

  // ── Socket events ────────────────────────────────────────────────────────
  useEffect(() => {
    const s = getSocket();

    s.on('"'"'matched'"'"', async ({ partnerId: pid, isInitiator }) => {
      setPartnerId(pid);

      // Trigger glitch + match flash
      setShowGlitch(true);
      setShowMatch(true);
      clearTimeout(glitchTimerRef.current);
      clearTimeout(matchTimerRef.current);
      glitchTimerRef.current = setTimeout(() => setShowGlitch(false), 1200);
      matchTimerRef.current = setTimeout(() => setShowMatch(false), 2000);

      setPhase('"'"'IN_CALL'"'"');
      const pc = createPeerConnection(pid, isInitiator);
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        s.emit('"'"'signal_offer'"'"', { targetId: pid, offer });
      }
    });

    s.on('"'"'signal_offer'"'"', async ({ offer, fromId }) => {
      const pc = createPeerConnection(fromId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      s.emit('"'"'signal_answer'"'"', { targetId: fromId, answer });
    });

    s.on('"'"'signal_answer'"'"', async ({ answer }) => {
      const pc = peerConnectionRef.current;
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    s.on('"'"'signal_ice'"'"', async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    s.on('"'"'partner_left'"'"', handlePartnerLeft);
    s.on('"'"'partner_skipped'"'"', () => { cleanupCall(); setPhase('"'"'ENDED'"'"'); });
    s.on('"'"'skipped_back_to_queue'"'"', () => setPhase('"'"'WAITING'"'"'));

    return () => {
      s.off('"'"'matched'"'"'); s.off('"'"'signal_offer'"'"'); s.off('"'"'signal_answer'"'"');
      s.off('"'"'signal_ice'"'"'); s.off('"'"'partner_left'"'"'); s.off('"'"'partner_skipped'"'"');
      s.off('"'"'skipped_back_to_queue'"'"');
    };
  }, [createPeerConnection, handlePartnerLeft, cleanupCall]);

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleStart = async () => {
    const stream = await startCamera();
    if (!stream) return;
    setPhase('"'"'WAITING'"'"');
    getSocket().emit('"'"'join_queue'"'"', { tags: selectedTags });
  };

  const handleSkip = () => {
    cleanupCall();
    getSocket().emit('"'"'skip'"'"');
    setPhase('"'"'WAITING'"'"');
    getSocket().emit('"'"'join_queue'"'"', { tags: selectedTags });
  };

  const handleEnd = () => {
    cleanupCall();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    getSocket().emit('"'"'leave_queue'"'"');
    setPhase('"'"'LANDING'"'"');
    setPartnerId(null);
    setSelectedTags([]);
  };

  const handleChatSend = () => {
    const text = chatInput.trim();
    if (!text) return;
    const dc = dataChannelRef.current;
    if (dc && dc.readyState === '"'"'open'"'"') {
      dc.send(JSON.stringify({ text }));
      setMessages(prev => [...prev, { text, type: '"'"'sent'"'"' }]);
    }
    setChatInput('"'"''"'"');
  };

  const handleChatKey = (e) => { if (e.key === '"'"'Enter'"'"') handleChatSend(); };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newMuted = !isMuted;
    stream.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    setIsMuted(newMuted);
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const newOff = !isVideoOff;
    stream.getVideoTracks().forEach(t => { t.enabled = !newOff; });
    setIsVideoOff(newOff);
  };

  const activeFilterClass = filter !== '"'"'none'"'"' ? `filter-${filter}` : '"'"''"'"';

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className='"'"'app'"'"'>
      <Particles />

      {/* Floating orbs */}
      <div className='"'"'orb orb-1'"'"' />
      <div className='"'"'orb orb-2'"'"' />
      <div className='"'"'orb orb-3'"'"' />

      {/* Glitch flash on match */}
      {showGlitch && <div className='"'"'glitch-overlay'"'"' />}

      {/* Match reveal flash */}
      {showMatch && (
        <div className='"'"'match-flash'"'"'>
          <div className='"'"'match-flash-text'"'"'>MATCH FOUND</div>
          <div className='"'"'match-flash-sub'"'"'>Connecting...</div>
        </div>
      )}

      {/* ── LANDING ── */}
      {phase === '"'"'LANDING'"'"' && (
        <div className='"'"'screen landing'"'"'>
          <div className='"'"'logo-wrap'"'"'>
            <div className='"'"'logo-icon-wrap'"'"'>📹</div>
            <h1 className='"'"'logo-title'"'"'>GChat</h1>
            <p className='"'"'logo-sub'"'"'>Random video chat with strangers</p>
          </div>

          {/* Tags */}
          <div className='"'"'tags-section'"'"'>
            <div className='"'"'tags-label'"'"'>Pick your interests (optional)</div>
            <div className='"'"'tags-grid'"'"'>
              {ALL_TAGS.map(tag => (
                <button
                  key={tag}
                  className={`tag-chip ${selectedTags.includes(tag) ? '"'"'selected'"'"' : '"'"''"'"'}`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Camera preview */}
          <div className='"'"'cam-wrap'"'"'>
            <video ref={localVideoRef} autoPlay muted playsInline />
            <div className='"'"'cam-placeholder'"'"'>
              <div className='"'"'cam-placeholder-emoji'"'"'>📷</div>
              Camera preview
            </div>
          </div>

          {error && <div className='"'"'toast'"'"'>{error}</div>}

          <button className='"'"'btn-start'"'"' onClick={handleStart}>
            Start Chatting
          </button>
        </div>
      )}

      {/* ── WAITING ── */}
      {phase === '"'"'WAITING'"'"' && (
        <div className='"'"'screen waiting'"'"'>
          <div className='"'"'waiting-pulse'"'"'>📹</div>
          <h2 className='"'"'waiting-title'"'"'>Finding someone...</h2>
          <p className='"'"'waiting-sub'"'"'>Hold on, connecting you with a stranger</p>
          <div className='"'"'waiting-dot-row'"'"'>
            <div className='"'"'waiting-dot'"'"' />
            <div className='"'"'waiting-dot'"'"' />
            <div className='"'"'waiting-dot'"'"' />
          </div>
          <button className='"'"'btn-ghost'"'"' onClick={handleEnd}>Cancel</button>
        </div>
      )}

      {/* ── IN CALL ── */}
      {phase === '"'"'IN_CALL'"'"' && (
        <div className='"'"'screen incall'"'"'>
          {/* Remote video with filter */}
          <video
            ref={remoteVideoRef}
            autoPlay playsInline
            className={`remote-video ${activeFilterClass}`}
          />

          {/* Tilt-shift overlay */}
          <div className='"'"'tiltshift-overlay'"'"' />

          {/* Local PiP */}
          <div className='"'"'local-pip'"'"'>
            <video ref={localVideoRef} autoPlay muted playsInline />
            {isVideoOff && <div className='"'"'pip-offline'"'"'>📷 Off</div>}
          </div>

          {/* Filter bar */}
          <div className='"'"'filter-bar'"'"'>
            {[
              { key: '"'"'none'"'"', label: '"'"'Normal'"'"' },
              { key: '"'"'blur'"'"', label: '"'"'Blur'"'"' },
              { key: '"'"'neon'"'"', label: '"'"'Neon'"'"' },
              { key: '"'"'noir'"'"', label: '"'"'Noir'"'"' },
              { key: '"'"'cyber'"'"', label: '"'"'Cyber'"'"' },
              { key: '"'"'mirror'"'"', label: '"'"'Mirror'"'"' },
            ].map(f => (
              <button
                key={f.key}
                className={`filter-btn ${filter === f.key ? '"'"'active'"'"' : '"'"''"'"'}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Controls */}
          <div className='"'"'controls-overlay'"'"'>
            <button className={`ctrl-btn ${isMuted ? '"'"'off'"'"' : '"'"''"'"'}`} onClick={toggleMute} title={isMuted ? '"'"'Unmute'"'"' : '"'"'Mute'"'"'}>
              {isMuted ? '"'"'🔇'"'"' : '"'"'🎙️'"'"'}
            </button>
            <button className='"'"'ctrl-btn end-call'"'"' onClick={handleEnd} title='"'"'End'"'"'>📴</button>
            <button className={`ctrl-btn ${isVideoOff ? '"'"'off'"'"' : '"'"''"'"'}`} onClick={toggleVideo} title={isVideoOff ? '"'"'Cam on'"'"' : '"'"'Cam off'"'"'}>
              {isVideoOff ? '"'"'🚫'"'"' : '"'"'📷'"'"'}
            </button>
            <button className='"'"'ctrl-btn skip-btn'"'"' onClick={handleSkip} title='"'"'Skip'"'"'>⏭️</button>
          </div>

          {/* Chat */}
          <div className='"'"'chat-panel'"'"'>
            <div className='"'"'chat-header'"'"'>💬 Chat</div>
            <div className='"'"'chat-messages'"'"'>
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-${msg.type}`}>{msg.text}</div>
              ))}
            </div>
            <div className='"'"'chat-input-row'"'"'>
              <input
                className='"'"'chat-input'"'"'
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={handleChatKey}
                placeholder='"'"'Type a message...'"'"'
                maxLength={500}
              />
              <button className='"'"'btn-send'"'"' onClick={handleChatSend}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ENDED ── */}
      {phase === '"'"'ENDED'"'"' && (
        <div className='"'"'screen ended'"'"'>
          <h2>Chat ended</h2>
          <p>Your partner left the conversation</p>
          <div className='"'"'ended-actions'"'"'>
            <button className='"'"'btn-start'"'"' onClick={handleStart}>🔄 Find New Stranger</button>
            <button className='"'"'btn-ghost'"'"' onClick={handleEnd}>← Back to Home</button>
          </div>
        </div>
      )}
    </div>
  );
}
