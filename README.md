# GChat — Random Video Chat

## Setup

### 1. Install dependencies
```bash
cd server && npm install
cd ../client && npm install
```

### 2. Start server
```bash
cd server
node index.js
# runs on http://localhost:3001
```

### 3. Start client
```bash
cd client
npm run dev
# runs on http://localhost:5173
```

### 4. Environment variables

**Server (.env):**
```
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=eu
```

**Client (.env):**
```
VITE_SIGNAL_URL=http://localhost:3001
VITE_PUSHER_KEY=your_key
VITE_PUSHER_CLUSTER=eu
```

## Deploy

- **Server** → Render.com (Web Service, `node index.js`)
- **Client** → Vercel (static, `client/dist`)
