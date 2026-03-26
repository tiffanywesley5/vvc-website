// ============================================
// VVC AGENT 1: CUSTOMER INQUIRY AGENT (PRODUCTION)
// ============================================
// FIX 1: Dashboard authentication (password protected)
// FIX 2: Server-side session IDs (never trust the client)
// FIX 3: Rate limiting (prevent spam and bill abuse)
// FIX 4: Input sanitization (message length + character limits)
// FIX 5: Lead capture (collect emails from interested visitors)

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============================================
// FIX 1: DASHBOARD AUTHENTICATION
// ============================================
// Set your dashboard password in .env:
// DASHBOARD_PASSWORD=your-secret-password
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'vvc-admin-2026';

function requireAuth(req, res, next) {
  // Check for password in query string or authorization header
  const queryPass = req.query.key;
  const headerPass = req.headers['x-dashboard-key'];
  const cookiePass = parseCookie(req.headers.cookie || '', 'vvc_auth');

  if (queryPass === DASHBOARD_PASSWORD || headerPass === DASHBOARD_PASSWORD || cookiePass === DASHBOARD_PASSWORD) {
    return next();
  }

  // Show login form
  res.send(`<!DOCTYPE html>
<html><head><title>VVC Dashboard Login</title>
<style>
  body { font-family: 'DM Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #faf9f7; }
  .login { background: #fff; padding: 40px; border-radius: 16px; border: 1px solid #e8e6e3; text-align: center; max-width: 360px; }
  h2 { margin-bottom: 20px; font-size: 22px; }
  input { width: 100%; padding: 12px; border: 1px solid #e0ddd9; border-radius: 8px; font-size: 16px; margin-bottom: 12px; font-family: inherit; }
  button { width: 100%; padding: 12px; background: #1a1a1a; color: #fff; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-family: inherit; }
  .error { color: #E53E3E; font-size: 14px; margin-bottom: 12px; }
</style></head><body>
<div class="login">
  <h2>VVC Agent Dashboard</h2>
  ${req.query.fail ? '<p class="error">Wrong password. Try again.</p>' : ''}
  <form method="GET" action="/dashboard/login">
    <input type="password" name="key" placeholder="Dashboard password" autofocus />
    <button type="submit">Log In</button>
  </form>
</div></body></html>`);
}

// Login route — sets a cookie so you don't re-enter every page load
app.get('/dashboard/login', (req, res) => {
  if (req.query.key === DASHBOARD_PASSWORD) {
    res.setHeader('Set-Cookie', `vvc_auth=${DASHBOARD_PASSWORD}; Path=/; HttpOnly; Max-Age=86400`);
    res.redirect('/dashboard');
  } else {
    res.redirect('/dashboard?fail=1');
  }
});

function parseCookie(cookieStr, name) {
  const match = cookieStr.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

// ============================================
// FIX 3: RATE LIMITING
// ============================================
// Simple in-memory rate limiter: max 10 messages per minute per IP
const rateLimitMap = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 10;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }

  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);

  if (timestamps.length > maxRequests) {
    return res.status(429).json({
      error: 'You are sending messages too quickly. Please wait a moment and try again.',
    });
  }

  next();
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const recent = timestamps.filter(t => now - t < 60000);
    if (recent.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, recent);
  }
}, 5 * 60 * 1000);

// ============================================
// DYNAMIC KNOWLEDGE BASE (auto-reloads with debounce)
// ============================================
const kbPath = path.join(__dirname, 'knowledge-base');

function loadKnowledgeBase() {
  const files = fs.readdirSync(kbPath).filter(f => f.endsWith('.txt'));
  let knowledge = '';
  for (const file of files) {
    const content = fs.readFileSync(path.join(kbPath, file), 'utf-8');
    knowledge += `\n\n--- ${file.toUpperCase()} ---\n${content}`;
  }
  return knowledge;
}

let knowledgeBase = loadKnowledgeBase();
console.log('Knowledge base loaded successfully.');

// FIX 9 (partial): Debounced file watcher
let reloadTimeout = null;
fs.watch(kbPath, (eventType, filename) => {
  if (filename && filename.endsWith('.txt')) {
    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(() => {
      console.log(`\n📄 Knowledge base updated: ${filename}. Reloading...`);
      knowledgeBase = loadKnowledgeBase();
      console.log('   Reloaded successfully.\n');
    }, 500); // Wait 500ms to debounce duplicate events
  }
});

// ============================================
// FIX 2: SERVER-SIDE SESSION MANAGEMENT
// ============================================
// Sessions are created and stored on the server.
// The client only gets an opaque session token.
const sessions = new Map();

function createSession(ip) {
  const id = 'session-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  sessions.set(id, {
    id,
    ip,
    createdAt: new Date().toISOString(),
    history: [],
    leadCaptured: false,
    messageCount: 0,
  });
  return id;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

// Clean up old sessions (older than 2 hours)
setInterval(() => {
  const cutoff = Date.now() - (2 * 60 * 60 * 1000);
  for (const [id, session] of sessions.entries()) {
    if (new Date(session.createdAt).getTime() < cutoff) {
      sessions.delete(id);
    }
  }
}, 30 * 60 * 1000);

// ============================================
// CONVERSATION LOGGING
// ============================================
const logsDir = path.join(__dirname, 'logs');
const conversationsDir = path.join(logsDir, 'conversations');
const escalationsFile = path.join(logsDir, 'escalations.json');
const analyticsFile = path.join(logsDir, 'analytics.json');
const leadsFile = path.join(logsDir, 'leads.json');

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
if (!fs.existsSync(conversationsDir)) fs.mkdirSync(conversationsDir);

function loadAnalytics() {
  if (fs.existsSync(analyticsFile)) {
    return JSON.parse(fs.readFileSync(analyticsFile, 'utf-8'));
  }
  return {
    totalConversations: 0,
    totalMessages: 0,
    escalations: 0,
    leadsCollected: 0,
    intents: { SERVICES: 0, PROCESS: 0, PORTFOLIO: 0, GENERAL: 0, ESCALATE: 0 },
    topQuestions: [],
    dailyActivity: {},
  };
}

function saveAnalytics(data) {
  fs.writeFileSync(analyticsFile, JSON.stringify(data, null, 2));
}

let analytics = loadAnalytics();

function logConversation(sessionId, message, response, intent) {
  const today = new Date().toISOString().split('T')[0];
  const timestamp = new Date().toISOString();

  const convoFile = path.join(conversationsDir, `${sessionId}.json`);
  let convo = [];
  if (fs.existsSync(convoFile)) {
    convo = JSON.parse(fs.readFileSync(convoFile, 'utf-8'));
  }
  convo.push({ timestamp, visitor: message, agent: response, intent });
  fs.writeFileSync(convoFile, JSON.stringify(convo, null, 2));

  analytics.totalMessages++;
  if (convo.length === 1) analytics.totalConversations++;
  if (intent && analytics.intents[intent] !== undefined) {
    analytics.intents[intent]++;
  }
  if (!analytics.dailyActivity[today]) analytics.dailyActivity[today] = 0;
  analytics.dailyActivity[today]++;

  analytics.topQuestions.push({ question: message, timestamp, intent });
  if (analytics.topQuestions.length > 500) {
    analytics.topQuestions = analytics.topQuestions.slice(-500);
  }

  saveAnalytics(analytics);
}

function logEscalation(sessionId, message, response) {
  const escalation = {
    timestamp: new Date().toISOString(),
    sessionId,
    visitorMessage: message,
    agentResponse: response,
    reviewed: false,
  };

  let escalations = [];
  if (fs.existsSync(escalationsFile)) {
    escalations = JSON.parse(fs.readFileSync(escalationsFile, 'utf-8'));
  }
  escalations.push(escalation);
  fs.writeFileSync(escalationsFile, JSON.stringify(escalations, null, 2));

  analytics.escalations++;
  saveAnalytics(analytics);

  console.log(`\n🚨 ESCALATION DETECTED`);
  console.log(`   Visitor asked: "${message.substring(0, 80)}..."`);
  console.log(`   Session: ${sessionId}`);
  console.log(`   Review at: /dashboard\n`);
}

// ============================================
// FIX 5: LEAD CAPTURE
// ============================================
function saveLead(sessionId, email, context) {
  const lead = {
    timestamp: new Date().toISOString(),
    sessionId,
    email,
    context,
  };

  let leads = [];
  if (fs.existsSync(leadsFile)) {
    leads = JSON.parse(fs.readFileSync(leadsFile, 'utf-8'));
  }
  leads.push(lead);
  fs.writeFileSync(leadsFile, JSON.stringify(leads, null, 2));

  analytics.leadsCollected++;
  saveAnalytics(analytics);

  console.log(`\n📧 NEW LEAD CAPTURED`);
  console.log(`   Email: ${email}`);
  console.log(`   Session: ${sessionId}\n`);
}

// Lead capture endpoint
app.post('/api/lead', rateLimit, (req, res) => {
  const { email, sessionId } = req.body;

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required.' });
  }

  const session = getSession(sessionId);
  const context = session ? session.history.slice(-4).map(m => m.content).join(' | ') : 'No context';

  saveLead(sessionId, email.trim().toLowerCase(), context);

  if (session) session.leadCaptured = true;

  res.json({ success: true, message: 'Thanks! Tiffany will follow up with you soon.' });
});

// ============================================
// INQUIRY / INTAKE FORM ENDPOINT
// ============================================
const inquiriesFile = path.join(logsDir, 'inquiries.json');

app.post('/api/inquiry', rateLimit, (req, res) => {
  const data = req.body;

  if (!data.name || !data.email) {
    return res.status(400).json({ error: 'Name and email are required.' });
  }

  const inquiry = {
    timestamp: new Date().toISOString(),
    name: data.name,
    email: data.email,
    phone: data.phone || '',
    business_name: data.business_name || '',
    website: data.website || '',
    industry: data.industry || '',
    services: data.services || [],
    description: data.description || '',
    audience: data.audience || '',
    existing_assets: data.existing_assets || '',
    current_tools: data.current_tools || '',
    timeline: data.timeline || '',
    budget: data.budget || '',
    referral_source: data.referral_source || '',
    additional_notes: data.additional_notes || '',
    interest: data.interest || '',
    message: data.message || '',
    type: data.services ? 'intake' : 'contact',
    reviewed: false,
  };

  let inquiries = [];
  if (fs.existsSync(inquiriesFile)) {
    inquiries = JSON.parse(fs.readFileSync(inquiriesFile, 'utf-8'));
  }
  inquiries.push(inquiry);
  fs.writeFileSync(inquiriesFile, JSON.stringify(inquiries, null, 2));

  console.log(`\n📋 NEW ${inquiry.type.toUpperCase()} FORM SUBMISSION`);
  console.log(`   Name: ${inquiry.name}`);
  console.log(`   Email: ${inquiry.email}`);
  console.log(`   Business: ${inquiry.business_name}`);
  if (inquiry.services.length) console.log(`   Services: ${inquiry.services.join(', ')}`);
  console.log(`   Review at: /dashboard\n`);

  res.json({ success: true });
});

// ============================================
// SYSTEM PROMPT
// ============================================
function buildSystemPrompt(session) {
  const leadPrompt = session && !session.leadCaptured && session.messageCount >= 2
    ? `\n- After 2-3 exchanges, if the visitor seems interested, naturally offer: "Want me to have Tiffany follow up with you directly? Just share your email and she will reach out." Do not be pushy about this. Only offer once.`
    : '';

  return `You are the virtual assistant for Velvet Vision Creative (VVC), a creative studio founded by Tiffany Snow in St. Louis, Missouri. You are the first point of contact for potential clients visiting the website.

YOUR PERSONALITY:
- Warm, professional, and confident, never stiff or corporate
- You reflect VVC's brand: creative, tech-forward, and approachable
- You speak clearly without jargon unless the visitor uses it first
- You are helpful but honest. If you do not know something, say so

YOUR JOB, THE ROUTING PATTERN:
When a visitor sends a message, silently classify their intent into one of these categories. Then include the classification as the very first word of your response, wrapped in brackets, like [SERVICES] or [ESCALATE]. This tag will be stripped before showing the response to the visitor.

Categories:
1. [SERVICES] They want to know what VVC offers or pricing
2. [PROCESS] They want to know how working with VVC works
3. [PORTFOLIO] They want to see examples or past work
4. [GENERAL] They have a general question about VVC
5. [ESCALATE] Their question requires Tiffany's personal attention

Then respond using ONLY the information in the knowledge base below.

YOUR RULES, THE GUARDRAILS:
- NEVER invent pricing that is not in the knowledge base
- NEVER promise specific timelines without checking the knowledge base
- NEVER pretend to be Tiffany or claim to be a human
- NEVER use markdown formatting like #, ##, **, or bullet points with dashes. Write in plain conversational sentences only.
- If asked about something not in the knowledge base, say: "That is a great question. I would recommend chatting with Tiffany directly about that. Want me to help you schedule a discovery call?"
- If the intent is ESCALATE, warmly offer to connect them with Tiffany via a discovery call
- Keep responses concise, 2-3 short paragraphs maximum
- End most responses with a helpful next step or question${leadPrompt}

YOUR KNOWLEDGE BASE:
${knowledgeBase}

Remember: You represent a real business. Accuracy matters more than impressiveness.`;
}

// ============================================
// FIX 4: INPUT SANITIZATION
// ============================================
function sanitizeMessage(message) {
  if (typeof message !== 'string') return null;

  // Trim whitespace
  let clean = message.trim();

  // Remove control characters (keep newlines and tabs)
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length to 500 characters
  if (clean.length > 500) {
    clean = clean.substring(0, 500);
  }

  // Reject empty messages
  if (clean.length === 0) return null;

  return clean;
}

// ============================================
// CHAT ENDPOINT (with all fixes applied)
// ============================================
app.post('/api/chat', rateLimit, async (req, res) => {
  try {
    let { message, sessionId } = req.body;

    // FIX 4: Sanitize input
    message = sanitizeMessage(message);
    if (!message) {
      return res.status(400).json({ error: 'Message is required (max 500 characters).' });
    }

    // FIX 2: Server-side session management
    let session = getSession(sessionId);
    if (!session) {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      sessionId = createSession(ip);
      session = getSession(sessionId);
    }

    // Add user message to server-side history
    session.history.push({ role: 'user', content: message });
    session.messageCount++;

    // Build messages from server-side history (not client-sent history)
    const messages = session.history.slice(); // Use server's copy

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(session),
      messages: messages,
    }, { timeout: 15000 });

    let assistantMessage = response.content[0].text;

    // Extract intent tag
    let intent = 'GENERAL';
    const intentMatch = assistantMessage.match(/^\[(SERVICES|PROCESS|PORTFOLIO|GENERAL|ESCALATE)\]\s*/);
    if (intentMatch) {
      intent = intentMatch[1];
      assistantMessage = assistantMessage.replace(intentMatch[0], '').trim();
    }

    // Add assistant response to server-side history
    session.history.push({ role: 'assistant', content: assistantMessage });

    // Log conversation
    logConversation(sessionId, message, assistantMessage, intent);

    // Flag escalations
    if (intent === 'ESCALATE') {
      logEscalation(sessionId, message, assistantMessage);
    }

    res.json({
      response: assistantMessage,
      role: 'assistant',
      sessionId,
    });

  } catch (error) {
    console.error('Error calling Claude API:', error.message || error);
    res.status(500).json({
      error: 'Something went wrong. Please try again in a moment.',
    });
  }
});

// ============================================
// PROTECTED API ENDPOINTS (FIX 1)
// ============================================
app.get('/api/analytics', requireAuth, (req, res) => {
  res.json(analytics);
});

app.get('/api/conversations', requireAuth, (req, res) => {
  if (!fs.existsSync(conversationsDir)) return res.json([]);
  const files = fs.readdirSync(conversationsDir)
    .filter(f => f.endsWith('.json'))
    .sort().reverse().slice(0, 50);

  const conversations = files.map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(conversationsDir, f), 'utf-8'));
    return {
      sessionId: f.replace('.json', ''),
      messages: data.length,
      firstMessage: data[0]?.visitor || '',
      lastActive: data[data.length - 1]?.timestamp || '',
      hadEscalation: data.some(m => m.intent === 'ESCALATE'),
    };
  });
  res.json(conversations);
});

app.get('/api/escalations', requireAuth, (req, res) => {
  if (fs.existsSync(escalationsFile)) {
    res.json(JSON.parse(fs.readFileSync(escalationsFile, 'utf-8')).reverse());
  } else {
    res.json([]);
  }
});

app.get('/api/leads', requireAuth, (req, res) => {
  if (fs.existsSync(leadsFile)) {
    res.json(JSON.parse(fs.readFileSync(leadsFile, 'utf-8')).reverse());
  } else {
    res.json([]);
  }
});

app.get('/api/inquiries', requireAuth, (req, res) => {
  if (fs.existsSync(inquiriesFile)) {
    res.json(JSON.parse(fs.readFileSync(inquiriesFile, 'utf-8')).reverse());
  } else {
    res.json([]);
  }
});

// ============================================
// DASHBOARD (password protected via FIX 1)
// ============================================
app.get('/dashboard', requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VVC Agent Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; background: #faf9f7; color: #1a1a1a; padding: 32px; max-width: 960px; margin: 0 auto; }
    h1 { font-size: 28px; margin-bottom: 8px; }
    h2 { font-size: 20px; margin: 24px 0 12px; color: #6B4C9A; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat { background: #fff; border-radius: 12px; padding: 20px; border: 1px solid #e8e6e3; }
    .stat .number { font-size: 32px; font-weight: 700; color: #6B4C9A; }
    .stat .label { font-size: 13px; color: #888; margin-top: 4px; }
    .section { background: #fff; border-radius: 12px; padding: 20px; border: 1px solid #e8e6e3; margin-bottom: 20px; }
    .escalation { background: #FFF5F5; border-left: 4px solid #E53E3E; padding: 12px 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
    .escalation .time { font-size: 12px; color: #888; }
    .escalation .question { font-weight: 500; margin: 4px 0; }
    .lead { background: #F0FFF4; border-left: 4px solid #38A169; padding: 12px 16px; margin-bottom: 12px; border-radius: 0 8px 8px 0; }
    .lead .email { font-weight: 700; color: #38A169; }
    .lead .time { font-size: 12px; color: #888; }
    .convo { padding: 12px 0; border-bottom: 1px solid #f0eeec; }
    .convo:last-child { border: none; }
    .convo .meta { font-size: 12px; color: #888; }
    .convo .preview { margin-top: 4px; }
    .badge { display: inline-block; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-left: 8px; }
    .badge.esc { background: #E53E3E; }
    .intent-bar { display: flex; gap: 8px; flex-wrap: wrap; }
    .intent { background: #f2f0ed; padding: 8px 14px; border-radius: 8px; font-size: 13px; }
    .intent strong { color: #6B4C9A; }
    .refresh { background: #1a1a1a; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-family: inherit; font-size: 13px; }
    .refresh:hover { background: #333; }
  </style>
</head>
<body>
  <h1>VVC Agent Dashboard</h1>
  <p class="subtitle">Customer Inquiry Agent &nbsp; <button class="refresh" onclick="loadAll()">Refresh</button></p>

  <div class="stats" id="stats"></div>

  <h2>Intent Breakdown</h2>
  <div class="intent-bar" id="intents"></div>

  <h2>Inquiries (Form Submissions)</h2>
  <div class="section" id="inquiries"><p style="color:#888">Loading...</p></div>

  <h2>Leads Captured</h2>
  <div class="section" id="leads"><p style="color:#888">Loading...</p></div>

  <h2>Escalations (Needs Your Attention)</h2>
  <div class="section" id="escalations"><p style="color:#888">Loading...</p></div>

  <h2>Recent Conversations</h2>
  <div class="section" id="conversations"><p style="color:#888">Loading...</p></div>

  <script>
    async function loadAll() {
      const [analytics, escalations, conversations, leads, inquiries] = await Promise.all([
        fetch('/api/analytics').then(r => r.json()),
        fetch('/api/escalations').then(r => r.json()),
        fetch('/api/conversations').then(r => r.json()),
        fetch('/api/leads').then(r => r.json()),
        fetch('/api/inquiries').then(r => r.json()),
      ]);

      document.getElementById('stats').innerHTML =
        stat(analytics.totalConversations, 'Conversations') +
        stat(analytics.totalMessages, 'Messages') +
        stat(analytics.escalations, 'Escalations') +
        stat(analytics.leadsCollected || 0, 'Leads') +
        stat(Object.keys(analytics.dailyActivity).length, 'Active Days');

      document.getElementById('intents').innerHTML = Object.entries(analytics.intents)
        .map(([k, v]) => '<div class="intent"><strong>' + v + '</strong> ' + k + '</div>').join('');

      document.getElementById('leads').innerHTML = leads.length === 0
        ? '<p style="color:#888">No leads captured yet. Visitors will be prompted after a few exchanges.</p>'
        : leads.slice(0, 20).map(l =>
          '<div class="lead"><div class="email">' + esc(l.email) + '</div>' +
          '<div class="time">' + new Date(l.timestamp).toLocaleString() + '</div>' +
          '<div style="font-size:13px;color:#666;margin-top:4px">' + esc(l.context.substring(0, 120)) + '</div></div>'
        ).join('');

      document.getElementById('inquiries').innerHTML = inquiries.length === 0
        ? '<p style="color:#888">No form submissions yet. Inquiries from the contact and intake forms will appear here.</p>'
        : inquiries.slice(0, 30).map(inq =>
          '<div class="lead" style="border-left-color:var(--purple,#6B3FA0);">' +
          '<div class="email" style="color:var(--purple,#6B3FA0);">' + esc(inq.name) + ' — ' + esc(inq.email) + '</div>' +
          '<div class="time">' + new Date(inq.timestamp).toLocaleString() + ' | ' + (inq.type || 'contact') + ' form</div>' +
          (inq.business_name ? '<div style="font-size:13px;color:#444;margin-top:4px"><strong>Business:</strong> ' + esc(inq.business_name) + '</div>' : '') +
          (inq.services && inq.services.length ? '<div style="font-size:13px;color:#444;"><strong>Services:</strong> ' + esc(inq.services.join(', ')) + '</div>' : '') +
          (inq.description ? '<div style="font-size:13px;color:#666;margin-top:4px">' + esc(inq.description.substring(0, 200)) + '</div>' : '') +
          (inq.message ? '<div style="font-size:13px;color:#666;margin-top:4px">' + esc(inq.message.substring(0, 200)) + '</div>' : '') +
          (inq.budget ? '<div style="font-size:12px;color:#888;margin-top:4px">Budget: ' + esc(inq.budget) + ' | Timeline: ' + esc(inq.timeline || 'not specified') + '</div>' : '') +
          '</div>'
        ).join('');

      document.getElementById('escalations').innerHTML = escalations.length === 0
        ? '<p style="color:#888">No escalations yet.</p>'
        : escalations.slice(0, 20).map(e =>
          '<div class="escalation"><div class="time">' + new Date(e.timestamp).toLocaleString() + '</div>' +
          '<div class="question">' + esc(e.visitorMessage) + '</div>' +
          '<div style="font-size:13px;color:#666">' + esc(e.agentResponse.substring(0, 150)) + '...</div></div>'
        ).join('');

      document.getElementById('conversations').innerHTML = conversations.length === 0
        ? '<p style="color:#888">No conversations yet.</p>'
        : conversations.slice(0, 30).map(c =>
          '<div class="convo"><div class="meta">' + new Date(c.lastActive).toLocaleString() +
          ' (' + c.messages + ' msgs)' +
          (c.hadEscalation ? '<span class="badge esc">ESCALATED</span>' : '') +
          '</div><div class="preview">' + esc(c.firstMessage) + '</div></div>'
        ).join('');
    }

    function stat(n, label) {
      return '<div class="stat"><div class="number">' + n + '</div><div class="label">' + label + '</div></div>';
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }

    loadAll();
  </script>
</body>
</html>`);
});

// Health check (public, no auth needed)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'VVC Inquiry Agent is running.',
    stats: {
      conversations: analytics.totalConversations,
      messages: analytics.totalMessages,
      escalations: analytics.escalations,
      leads: analytics.leadsCollected || 0,
    },
  });
});

// Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🟢 VVC Agent server is running at http://localhost:${PORT}`);
  console.log(`   Chat widget:  http://localhost:${PORT}`);
  console.log(`   Dashboard:    http://localhost:${PORT}/dashboard`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
  console.log(`\n   Dashboard password: ${DASHBOARD_PASSWORD}`);
  console.log(`   (Change it in your .env file: DASHBOARD_PASSWORD=your-secret)\n`);
});
