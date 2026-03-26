// ============================================
// VVC WEBSITE — SHARED COMPONENTS
// Nav, Footer, Chat Widget (injected on every page)
// ============================================

// ===== CHANGE THIS WHEN AGENT 1 IS DEPLOYED =====
const AGENT_API_URL = 'https://vvc-agent.onrender.com';

// ===== NAVIGATION =====
function renderNav(activePage) {
  const nav = document.createElement('nav');
  nav.innerHTML = `
    <a href="/" class="nav-logo"><img src="/images/v-icon.svg" alt="VVC" style="height:32px;display:inline-block;vertical-align:middle;margin-right:8px" /><span style="font-family:var(--font-display);font-size:18px;font-weight:700;color:var(--charcoal);vertical-align:middle">Velvet Vision Creative</span></a>
    <div class="nav-links" id="nav-links">
      <a href="/" class="${activePage === 'home' ? 'active' : ''}">Home</a>
      <a href="/about.html" class="${activePage === 'about' ? 'active' : ''}">About</a>
      <a href="/services.html" class="${activePage === 'services' ? 'active' : ''}">Services</a>
      <a href="/process.html" class="${activePage === 'process' ? 'active' : ''}">How We Work</a>
      <a href="/portfolio.html" class="${activePage === 'portfolio' ? 'active' : ''}">Portfolio</a>
      <a href="/intake.html" class="${activePage === 'intake' ? 'active' : ''}">Start a Project</a>
      <a href="/contact.html" class="btn btn-primary btn-sm nav-cta">Book a Call</a>
    </div>
    <button class="mobile-toggle" id="mobile-toggle" aria-label="Menu">&#9776;</button>
  `;
  document.body.prepend(nav);

  // Scroll effect
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
  });

  // Mobile menu
  document.getElementById('mobile-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });
}

// ===== FOOTER =====
function renderFooter() {
  const footer = document.createElement('footer');
  footer.innerHTML = `
    <div class="container">
      <div class="footer-grid">
        <div class="footer-brand">
          <h4>Velvet Vision Creative</h4>
          <p>AI-forward creative studio building brand identities, AI agent systems, and digital infrastructure for founders and small businesses.</p>
        </div>
        <div>
          <h4>Navigate</h4>
          <div class="footer-links">
            <a href="/">Home</a>
            <a href="/about.html">About</a>
            <a href="/services.html">Services</a>
            <a href="/process.html">How We Work</a>
            <a href="/portfolio.html">Portfolio</a>
            <a href="/contact.html">Contact</a>
          </div>
        </div>
        <div>
          <h4>Connect</h4>
          <div class="footer-links">
            <a href="mailto:hello@velvetvisioncreative.com">hello@velvetvisioncreative.com</a>
            <a href="#">LinkedIn</a>
            <a href="#">Substack (TVA)</a>
            <a href="#">Instagram</a>
          </div>
        </div>
      </div>
      <div class="footer-bottom">
        <span>&copy; 2026 Velvet Vision Creative LLC. All rights reserved.</span>
        <span class="footer-tagline">Beauty &times; Technology &times; Ownership</span>
      </div>
    </div>
  `;
  // Insert before chat widget
  const chatToggle = document.getElementById('chat-toggle');
  if (chatToggle) document.body.insertBefore(footer, chatToggle);
  else document.body.appendChild(footer);
}

// ===== CHAT WIDGET =====
function renderChat() {
  const chatHTML = `
    <button id="chat-toggle" aria-label="Chat with us">&#128172;</button>
    <div id="chat-window">
      <div class="chat-header">
        Velvet Vision Creative
        <span>AI Assistant</span>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="msg assistant">Hey! Welcome to Velvet Vision Creative. I can help you learn about our services, how we work, or anything else about VVC. What can I help you with?</div>
      </div>
      <div class="lead-bar" id="lead-bar">
        <input type="email" id="lead-email" placeholder="Your email for follow-up" />
        <button id="lead-submit">Send</button>
        <button class="dismiss" id="lead-dismiss">&times;</button>
      </div>
      <div class="chat-input-area">
        <input type="text" id="chat-input" placeholder="Ask about our services..." autocomplete="off" maxlength="500" />
        <button id="chat-send">Send</button>
      </div>
    </div>
  `;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = chatHTML;
  while (wrapper.firstChild) document.body.appendChild(wrapper.firstChild);

  // Chat logic
  let sessionId = null;
  let messageCount = 0;
  let leadCaptured = false;

  const toggle = document.getElementById('chat-toggle');
  const chatWindow = document.getElementById('chat-window');
  const messagesDiv = document.getElementById('chat-messages');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  const leadBar = document.getElementById('lead-bar');
  const leadEmail = document.getElementById('lead-email');
  const leadSubmit = document.getElementById('lead-submit');
  const leadDismiss = document.getElementById('lead-dismiss');

  toggle.addEventListener('click', () => {
    chatWindow.classList.toggle('open');
    if (chatWindow.classList.contains('open')) input.focus();
  });

  function addMessage(text, role) {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'msg typing'; div.id = 'typing-indicator';
    div.textContent = 'Thinking...';
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('typing-indicator');
    if (el) el.remove();
  }

  function maybeShowLeadBar() {
    if (!leadCaptured && messageCount >= 3) leadBar.classList.add('show');
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || text.length > 500) return;

    addMessage(text, 'user');
    input.value = '';
    sendBtn.disabled = true;
    showTyping();

    try {
      const response = await fetch(AGENT_API_URL + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      });

      if (response.status === 429) {
        hideTyping();
        addMessage("You're sending messages a bit too fast. Give me a moment!", 'assistant');
        sendBtn.disabled = false; input.focus(); return;
      }

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (data.sessionId) sessionId = data.sessionId;

      hideTyping();
      addMessage(data.response, 'assistant');
      messageCount++;
      maybeShowLeadBar();
    } catch (error) {
      hideTyping();
      addMessage("Sorry, I'm having trouble right now. Please try again in a moment!", 'assistant');
    }
    sendBtn.disabled = false; input.focus();
  }

  // Lead capture
  leadSubmit.addEventListener('click', async () => {
    const email = leadEmail.value.trim();
    if (!email || !email.includes('@')) { leadEmail.style.borderColor = '#E53E3E'; return; }
    try {
      const res = await fetch(AGENT_API_URL + '/api/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, sessionId }),
      });
      const data = await res.json();
      if (data.success) { leadBar.classList.remove('show'); leadCaptured = true; addMessage("Thanks! Tiffany will follow up with you directly.", 'assistant'); }
    } catch (e) { console.error(e); }
  });

  leadDismiss.addEventListener('click', () => { leadBar.classList.remove('show'); leadCaptured = true; });
  leadEmail.addEventListener('keydown', (e) => { if (e.key === 'Enter') leadSubmit.click(); });
  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  const page = document.body.dataset.page || 'home';
  renderNav(page);
  renderChat();
  renderFooter();

  // Trigger reveal animations for elements in view
  const reveals = document.querySelectorAll('.reveal');
  reveals.forEach(el => el.style.opacity = '0');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.animation = 'fadeUp 0.7s ease-out forwards';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });
  reveals.forEach(el => observer.observe(el));
});
