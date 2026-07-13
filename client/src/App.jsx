import { useState, useEffect, useRef, useCallback } from 'react';
import Pusher from 'pusher-js';
import './App.css';

// ── Config ────────────────────────────────────────────────────────────────
const SIGNAL_URL = import.meta.env.VITE_SIGNAL_URL || 'http://localhost:3001';
const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY || 'e79b0eb928758744ff45';
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER || 'eu';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const ALL_TAGS = [
  'Gaming', 'Music', 'Art', 'Tech', 'Travel', 'Fitness', 'Food',
  'Movies', 'Books', 'Fashion', 'Photography', 'Crypto', 'Sports',
  'Coding', 'Comedy', 'Nature', 'Anime', 'Dance', 'DIY', 'Travel',
];

// ── Helpers ──────────────────────────────────────────────────────────────
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

// ── Particle canvas ──────────────────────────────────────────────────────
function Particles() {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    const colors = [
      'rgba(168,85,247,', 'rgba(99,102,241,', 'rgba(236,72,153,',
    ];
    const particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 2 + 0.5,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.5 + 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color + p.alpha + ')';
        ctx.fill();
      });
      animRef.current = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', () => { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; });
    draw();
    return () => { cancelAnimationFrame(animRef.current); };
  }, []);

  return <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1 }} />;
}

// ── Main App ────────────────────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState('LANDING');
  const [selectedTags, setSelectedTags] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('none');
  const [showGlitch, setShowGlitch] = useState(false);
  const [showMatch, setShowMatch] = useState(false);

  const myIdRef = useRef(generateId());
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const pusherRef = useRef(null);
  const channelRef = useRef(null);
  const glitchTimerRef = useRef(null);
  const matchTimerRef = useRef(null);

  // ── Toggle tag ──────────────────────────────────────────────────────
  const toggleTag = (tag) =>
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );

  // ── Camera ─────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' },
        audio: true,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
      stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });
      return stream;
    } catch {
      setError('Camera/mic access denied.');
      return null;
    }
  }, [isMuted, isVideoOff]);

  // ── Peer connection ─────────────────────────────────────────────────
  const createPeerConnection = useCallback((partnerId, isInitiator) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peerConnectionRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track =>
        pc.addTrack(track, localStreamRef.current)
      );
    }

    pc.onicecandidate = ({ candidate }) => {
      if (candidate && roomId) {
        fetch(`${SIGNAL_URL}/api/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, event: 'signal_ice', data: { candidate }, targetId: myIdRef.current }),
        }).catch(console.error);
      }
    };

    pc.ontrack = ({ streams }) => {
      if (remoteVideoRef.current && streams[0]) remoteVideoRef.current.srcObject = streams[0];
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState)) handlePartnerLeft();
    };

    return pc;
  }, [roomId]);

  // ── Cleanup ────────────────────────────────────────────────────────
  const cleanupCall = useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unbind_all();
      channelRef.current.unsubscribe();
      channelRef.current = null;
    }
    if (peerConnectionRef.current) { peerConnectionRef.current.close(); peerConnectionRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setMessages([]);
    setFilter('none');
  }, []);

  const handlePartnerLeft = useCallback(() => {
    cleanupCall();
    setPhase('ENDED');
  }, [cleanupCall]);

  // ── Join queue ─────────────────────────────────────────────────────
  const joinQueue = async () => {
    const res = await fetch(`${SIGNAL_URL}/api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socketId: myIdRef.current, tags: selectedTags }),
    });
    return res.ok;
  };

  const leaveQueue = async () => {
    await fetch(`${SIGNAL_URL}/api/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socketId: myIdRef.current }),
    }).catch(() => {});
  };

  // ── Pusher setup ───────────────────────────────────────────────────
  const setupPusher = useCallback((targetRoomId, isInitiator, partnerId) => {
    if (pusherRef.current) {
      pusherRef.current.disconnect();
    }

    const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
    pusherRef.current = pusher;

    const channel = pusher.subscribe(`gchat-room-${targetRoomId}`);
    channelRef.current = channel;

    channel.bind('matched', async ({ partnerId: pid, isInitiator: isInit }) => {
      if (pid !== myIdRef.current) return;

      // Trigger effects
      setShowGlitch(true);
      setShowMatch(true);
      clearTimeout(glitchTimerRef.current);
      clearTimeout(matchTimerRef.current);
      glitchTimerRef.current = setTimeout(() => setShowGlitch(false), 1200);
      matchTimerRef.current = setTimeout(() => setShowMatch(false), 2000);

      setPhase('IN_CALL');
      const pc = createPeerConnection(pid, isInit);
      if (isInit) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await fetch(`${SIGNAL_URL}/api/signal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: targetRoomId, event: 'signal_offer', data: { offer }, targetId: pid }),
        });
      }
    });

    channel.bind('signal_offer', async ({ offer, fromId }) => {
      if (fromId !== partnerId) return;
      const pc = createPeerConnection(fromId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await fetch(`${SIGNAL_URL}/api/signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: targetRoomId, event: 'signal_answer', data: { answer }, targetId: fromId }),
      });
    });

    channel.bind('signal_answer', async ({ answer }) => {
      const pc = peerConnectionRef.current;
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    channel.bind('signal_ice', async ({ candidate }) => {
      const pc = peerConnectionRef.current;
      if (pc && candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
      }
    });

    channel.bind('partner_left', handlePartnerLeft);

    channel.bind('chat_message', ({ text, fromId }) => {
      if (fromId !== myIdRef.current) {
        setMessages(prev => [...prev, { text, type: 'received' }]);
      }
    });

    // Poll for match (Pusher doesn't have a "trigger from server" equivalent without a backend)
    // We poll the server every 2s to check if matched
    const poll = setInterval(async () => {
      if (phase !== 'WAITING') { clearInterval(poll); return; }
      const res = await fetch(`${SIGNAL_URL}/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socketId: myIdRef.current, tags: selectedTags }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.roomId) {
        clearInterval(poll);
        setRoomId(data.roomId);
      }
    }, 2000);

    return () => clearInterval(poll);
  }, [createPeerConnection, handlePartnerLeft, phase, selectedTags]);

  // ── Actions ────────────────────────────────────────────────────────
  const handleStart = async () => {
    const stream = await startCamera();
    if (!stream) return;
    setPhase('WAITING');
    await joinQueue();
    setupPusher(null, false, null);
  };

  const handleSkip = () => {
    cleanupCall();
    setPhase('WAITING');
    joinQueue();
  };

  const handleEnd = async () => {
    cleanupCall();
    if (roomId) {
      await fetch(`${SIGNAL_URL}/api/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      }).catch(() => {});
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    await leaveQueue();
    setRoomId(null);
    setPhase('LANDING');
    setSelectedTags([]);
  };

  const handleChatSend = async () => {
    const text = chatInput.trim();
    if (!text || !roomId) return;
    const msg = { text, fromId: myIdRef.current };
    setMessages(prev => [...prev, { text, type: 'sent' }]);
    await fetch(`${SIGNAL_URL}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, event: 'chat_message', data: msg, targetId: null }),
    }).catch(console.error);
    setChatInput('');
  };

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

  const filterClass = filter !== 'none' ? `filter-${filter}` : '';

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="app">
      <Particles />
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      {showGlitch && <div className="glitch-overlay" />}

      {showMatch && (
        <div className="match-flash">
          <div className="match-flash-text">MATCH FOUND</div>
          <div className="match-flash-sub">Connecting...</div>
        </div>
      )}

      {/* ── LANDING ── */}
      {phase === 'LANDING' && (
        <div className="screen landing">
          <div className="logo-wrap">
            <div className="logo-icon-wrap">📹</div>
            <h1 className="logo-title">GChat</h1>
            <p className="logo-sub">Random video chat with strangers</p>
          </div>

          <div className="tags-section">
            <div className="tags-label">Pick your interests (optional)</div>
            <div className="tags-grid">
              {ALL_TAGS.map(tag => (
                <button key={tag}
                  className={`tag-chip ${selectedTags.includes(tag) ? 'selected' : ''}`}
                  onClick={() => toggleTag(tag)}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="cam-wrap">
            <video ref={localVideoRef} autoPlay muted playsInline />
            <div className="cam-placeholder">
              <div className="cam-placeholder-emoji">📷</div>
              Camera preview
            </div>
          </div>

          {error && <div className="toast">{error}</div>}

          <button className="btn-start" onClick={handleStart}>Start Chatting</button>
        </div>
      )}

      {/* ── WAITING ── */}
      {phase === 'WAITING' && (
        <div className="screen waiting">
          <div className="waiting-pulse">📹</div>
          <h2 className="waiting-title">Finding someone...</h2>
          <p className="waiting-sub">Hold on, connecting you with a stranger</p>
          <div className="waiting-dot-row">
            <div className="waiting-dot" />
            <div className="waiting-dot" />
            <div className="waiting-dot" />
          </div>
          <button className="btn-ghost" onClick={handleEnd}>Cancel</button>
        </div>
      )}

      {/* ── IN CALL ── */}
      {phase === 'IN_CALL' && (
        <div className="screen incall">
          <video ref={remoteVideoRef} autoPlay playsInline className={`remote-video ${filterClass}`} />
          <div className="tiltshift-overlay" />

          <div className="local-pip">
            <video ref={localVideoRef} autoPlay muted playsInline />
            {isVideoOff && <div className="pip-offline">📷 Off</div>}
          </div>

          <div className="filter-bar">
            {[
              { key: 'none', label: 'Normal' },
              { key: 'blur', label: 'Blur' },
              { key: 'neon', label: 'Neon' },
              { key: 'noir', label: 'Noir' },
              { key: 'cyber', label: 'Cyber' },
              { key: 'mirror', label: 'Mirror' },
            ].map(f => (
              <button key={f.key}
                className={`filter-btn ${filter === f.key ? 'active' : ''}`}
                onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          <div className="controls-overlay">
            <button className={`ctrl-btn ${isMuted ? 'off' : ''}`} onClick={toggleMute} title={isMuted ? 'Unmute' : 'Mute'}>
              {isMuted ? '🔇' : '🎙️'}
            </button>
            <button className="ctrl-btn end-call" onClick={handleEnd} title="End">📴</button>
            <button className={`ctrl-btn ${isVideoOff ? 'off' : ''}`} onClick={toggleVideo} title={isVideoOff ? 'Cam on' : 'Cam off'}>
              {isVideoOff ? '🚫' : '📷'}
            </button>
            <button className="ctrl-btn skip-btn" onClick={handleSkip} title="Skip">⏭️</button>
          </div>

          <div className="chat-panel">
            <div className="chat-header">💬 Chat</div>
            <div className="chat-messages">
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg chat-${msg.type}`}>{msg.text}</div>
              ))}
            </div>
            <div className="chat-input-row">
              <input className="chat-input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChatSend()}
                placeholder="Type a message..."
                maxLength={500}
              />
              <button className="btn-send" onClick={handleChatSend}>Send</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ENDED ── */}
      {phase === 'ENDED' && (
        <div className="screen ended">
          <h2>Chat ended</h2>
          <p>Your partner left the conversation</p>
          <div className="ended-actions">
            <button className="btn-start" onClick={handleStart}>🔄 Find New Stranger</button>
            <button className="btn-ghost" onClick={handleEnd}>← Back to Home</button>
          </div>
        </div>
      )}
    </div>
  );
}
