/**
 * AI Service Client for Local LM Studio via Ngrok Tunnel
 * Connects to OpenAI-compatible REST API at:
 * https://strangely-disarray-diary.ngrok-free.dev -> http://localhost:1234
 */

const AI_STORAGE_KEY = "legacy_mgmt_ai_endpoint_v1";
const DEFAULT_NGROK_URL = "https://strangely-disarray-diary.ngrok-free.dev";
const DEFAULT_LOCAL_URL = "http://localhost:1234";
const NETLIFY_AI_PROXY = "/.netlify/functions/ai";

class AIService {
  constructor() {
    this.endpoint = localStorage.getItem(AI_STORAGE_KEY) || DEFAULT_NGROK_URL;
    this.model = "local-model";
    this.isConnected = false;
    this.lastChecked = null;
    this.availableModels = [];
    this.connectionMode = "proxy"; // "proxy" | "direct" | "localhost"
  }

  getEndpoint() {
    return this.endpoint.replace(/\/+$/, "");
  }

  setEndpoint(url) {
    this.endpoint = (url || DEFAULT_NGROK_URL).trim().replace(/\/+$/, "");
    localStorage.setItem(AI_STORAGE_KEY, this.endpoint);
  }

  async testConnection() {
    const cleanUrl = this.getEndpoint();

    // 1. Try Netlify AI Serverless Proxy first (Optimal for remote users like USA friend, eliminates CORS/Ngrok interstitials)
    try {
      const proxyUrl = `${NETLIFY_AI_PROXY}?endpoint=${encodeURIComponent(cleanUrl)}`;
      const resProxy = await fetch(proxyUrl, { method: "GET" });
      if (resProxy.ok) {
        const dataProxy = await resProxy.json();
        if (dataProxy.ok && Array.isArray(dataProxy.models)) {
          this.availableModels = dataProxy.models;
          this.model = dataProxy.activeModel || this.availableModels[0] || "local-model";
          this.isConnected = true;
          this.connectionMode = "proxy";
          this.lastChecked = new Date();
          return {
            success: true,
            models: this.availableModels,
            endpoint: cleanUrl,
            mode: "Serverless Proxy (Remote-Friendly 🇺🇸)"
          };
        }
      }
    } catch (proxyErr) {
      console.log("Netlify AI proxy not active, trying direct connection:", proxyErr.message);
    }

    // 2. Direct connection to Ngrok / Custom URL
    try {
      const res = await fetch(`${cleanUrl}/v1/models`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true"
        }
      });

      if (res.ok) {
        const data = await res.json();
        this.availableModels = data.data ? data.data.map(m => m.id) : ["local-model"];
        if (this.availableModels.length > 0) {
          this.model = this.availableModels[0];
        }
        this.isConnected = true;
        this.connectionMode = "direct";
        this.lastChecked = new Date();
        return { success: true, models: this.availableModels, endpoint: cleanUrl, mode: "Direct Tunnel" };
      }
    } catch (e) {
      // 3. Fallback on localhost if testing on the host machine
      if (cleanUrl !== DEFAULT_LOCAL_URL) {
        try {
          const resLocal = await fetch(`${DEFAULT_LOCAL_URL}/v1/models`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
          });
          if (resLocal.ok) {
            const dataLocal = await resLocal.json();
            this.availableModels = dataLocal.data ? dataLocal.data.map(m => m.id) : ["local-model"];
            this.model = this.availableModels[0] || "local-model";
            this.setEndpoint(DEFAULT_LOCAL_URL);
            this.isConnected = true;
            this.connectionMode = "localhost";
            this.lastChecked = new Date();
            return { success: true, models: this.availableModels, endpoint: DEFAULT_LOCAL_URL, mode: "Localhost" };
          }
        } catch (e2) {}
      }
    }

    this.isConnected = false;
    this.lastChecked = new Date();
    return {
      success: false,
      error: "Could not connect to LM Studio at " + cleanUrl + ". If you are in the US or remote, ensure Kevin's PC is running LM Studio + ngrok."
    };
  }

  async chatCompletion(messages, temperature = 0.7, maxTokens = 1200) {
    const cleanUrl = this.getEndpoint();
    const payload = {
      model: this.model || "local-model",
      messages: messages,
      temperature: temperature,
      max_tokens: maxTokens,
      endpoint: cleanUrl
    };

    // If connected via proxy, route through Netlify proxy
    if (this.connectionMode === "proxy") {
      try {
        const res = await fetch(NETLIFY_AI_PROXY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.choices && data.choices[0] && data.choices[0].message) {
            this.isConnected = true;
            return data.choices[0].message.content.trim();
          }
        }
      } catch (err) {
        console.warn("Proxy chat failed, attempting direct fallback:", err);
      }
    }

    // Direct fallback
    const res = await fetch(`${cleanUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    if (data.choices && data.choices[0] && data.choices[0].message) {
      this.isConnected = true;
      return data.choices[0].message.content.trim();
    }
    throw new Error("Invalid response format from LM Studio");
  }

  /**
   * Generates a comprehensive employee performance and status report.
   */
  async generateEmployeeReport(person) {
    const historyText = (person.history && person.history.length > 0)
      ? person.history.slice(0, 10).map(h => `- [${h.date}] (${h.author}): ${h.note}`).join("\n")
      : "No previous history logged.";

    const statusDescription = person.responsiveness === "red" 
      ? "🔴 Completely Unresponsive (Critical Alert - Possible Termination)"
      : (person.responsiveness === "yellow" 
          ? "🟡 Unresponsive (Needs Immediate Manager Follow-up)" 
          : "🟢 Active / Normal Responsiveness");

    const pipelineStatus = person.trainingStatus || "Active";

    const systemPrompt = `You are an elite Talent Management and Operations Director for MyLegacy. 
Your job is to analyze employee/trainee history, attendance, and responsiveness records to write an objective, actionable management report.
Write clearly with professional formatting, using bullet points and clear sections. Be concise yet thorough.`;

    const userPrompt = `Generate a detailed Performance & Status Report for the following team member:

--- EMPLOYEE PROFILE ---
- Name: ${person.name}
- Type: ${person.type === 'employee' ? 'Active Employee' : (person.type === 'trainee' ? 'Trainee' : 'Archived / Removed')}
- Position / Role: ${person.position || 'Talent Manager'}
- Trainer / Lead: ${person.trainer || 'N/A'}
- Start Date: ${person.startDate || 'N/A'}
- Pipeline Status: ${pipelineStatus}
- Responsiveness Flag: ${statusDescription}
- Expected Completion / Goals: ${person.expectedCompletion || 'N/A'}
- Current Notes: ${person.notes || 'None'}

--- RECENT CHECK-IN HISTORY & LOGS ---
${historyText}

--- REPORT STRUCTURE REQUIRED ---
Please format the report with these 4 clear sections:
1. 📌 Executive Overview & Status Assessment
2. ⏱️ Responsiveness, Attendance & Communication Diagnosis
3. 📈 Progress & Check-In History Audit
4. 💡 Actionable Manager Recommendations (e.g. Schedule 1-on-1, Transition to Onboarding, Issue Attendance Warning, or Disciplinary Action)`;

    return await this.chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], 0.6, 1200);
  }

  /**
   * Generates a personalized WhatsApp outreach message for a person.
   */
  async generateWhatsAppMessage(person, managerGoal, tone = "professional") {
    let toneGuidance = "friendly, professional, and clear";
    if (tone === "urgent") {
      toneGuidance = "urgent, direct, and serious regarding their unresponsive status or attendance";
    } else if (tone === "casual") {
      toneGuidance = "casual, warm, approachable, and encouraging";
    } else if (tone === "onboarding") {
      toneGuidance = "enthusiastic, supportive, welcoming them to the onboarding stage and detailing next steps";
    }

    const systemPrompt = `You are a manager at MyLegacy crafting a direct 1-on-1 WhatsApp message to a team member (${person.type}).
Keep the message concise, formatted for WhatsApp (using emojis and clear line breaks), and tailored to the manager's goal.
Tone: ${toneGuidance}.
Do NOT include email subject lines or placeholders. The message must be ready to send directly on WhatsApp.`;

    const statusContext = person.responsiveness === "red"
      ? "They are currently flagged as completely unresponsive (Red Alert)."
      : (person.responsiveness === "yellow"
          ? "They have missed recent check-ins or are unresponsive (Yellow Alert)."
          : "They are currently active.");

    const userPrompt = `Recipient Name: ${person.name}
Role: ${person.position || 'Talent Manager'}
Trainer: ${person.trainer || 'Management'}
Current Status: ${person.trainingStatus || 'Active'} (${statusContext})
Phone: ${person.phone || 'N/A'}

Manager's Goal / Reason for Outreach:
"${managerGoal || 'Check in on current progress and upcoming deliverables'}"

Write the ready-to-send WhatsApp message:`;

    return await this.chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ], 0.7, 400);
  }

  /**
   * Bulk generator: iterates through people and generates personalized WhatsApp messages.
   */
  async generateBulkWhatsAppMessages(peopleList, managerGoal, tone = "professional", onProgress = null) {
    const results = [];
    for (let i = 0; i < peopleList.length; i++) {
      const person = peopleList[i];
      if (onProgress) {
        onProgress(i + 1, peopleList.length, person.name);
      }
      try {
        const message = await this.generateWhatsAppMessage(person, managerGoal, tone);
        results.push({
          person: person,
          message: message,
          success: true
        });
      } catch (err) {
        results.push({
          person: person,
          message: `Hi ${person.name}, reaching out regarding: ${managerGoal || 'our check-in'}. Please message back when available!`,
          success: false,
          error: err.message
        });
      }
    }
    return results;
  }
}

window.aiService = new AIService();
