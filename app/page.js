"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { ref, onValue, set } from "firebase/database";
import { db } from "../lib/firebase";

const CHANNELS = [
  { id: "A1", label: "Fan",    color: "#00d4ff", icon: "FAN"    },
  { id: "A2", label: "Lights", color: "#a78bfa", icon: "LIGHT"  },
  { id: "A3", label: "AC",     color: "#34d399", icon: "AC"     },
  { id: "A4", label: "Geyser", color: "#fb923c", icon: "GEYSER" },
];

const OVERLOAD_THRESHOLD = 1500;
const DEFAULT_TARIFF = 8;

function makeDummy() {
  return {
    A1: { current: +(0.43+Math.random()*0.08).toFixed(2), voltage: +(229+Math.random()*2).toFixed(1), power: +(98+Math.random()*10).toFixed(1),  status: 1 },
    A2: { current: +(1.08+Math.random()*0.12).toFixed(2), voltage: +(230+Math.random()*2).toFixed(1), power: +(246+Math.random()*15).toFixed(1), status: 1 },
    A3: { current: +(2.85+Math.random()*0.20).toFixed(2), voltage: +(228+Math.random()*3).toFixed(1), power: +(652+Math.random()*30).toFixed(1), status: 1 },
    A4: { current: +(0.00).toFixed(2),                     voltage: +(230).toFixed(1),                power: +(0).toFixed(1),                     status: 0 },
  };
}

export default function Dashboard() {
  const [data, setData]                 = useState(makeDummy());
  const [connected, setConnected]       = useState(false);
  const [lastUpdate, setLastUpdate]     = useState(new Date().toLocaleTimeString());
  const [tariff, setTariff]             = useState(DEFAULT_TARIFF);
  const [runtimeHours, setRuntimeHours] = useState(8);
  const [dismissedAlarms, setDismissedAlarms] = useState([]);
  const [activeTab, setActiveTab]       = useState("dashboard");
  const [energyLog, setEnergyLog]       = useState({ A1:0, A2:0, A3:0, A4:0 });
  const [history, setHistory]           = useState([]);
  const [aiAnalysis, setAiAnalysis]     = useState("");
  const [aiLoading, setAiLoading]       = useState(false);
  const [aiError, setAiError]           = useState("");
  const lastLogTime   = useRef(Date.now());
  const useDemoRef    = useRef(true);
  const demoTimer     = useRef(null);

  const tickDemo = useCallback(() => {
    if (!useDemoRef.current) return;
    const d = makeDummy();
    const now = Date.now();
    const deltaHours = (now - lastLogTime.current) / 3600000;
    lastLogTime.current = now;
    setEnergyLog(prev => {
      const u = {...prev};
      CHANNELS.forEach(ch => { u[ch.id] = (prev[ch.id]||0) + ((+d[ch.id]?.power||0)*deltaHours)/1000; });
      return u;
    });
    setHistory(prev => [...prev, {
      time: new Date().toLocaleTimeString(),
      A1: +d.A1.power, A2: +d.A2.power, A3: +d.A3.power, A4: +d.A4.power,
      total: CHANNELS.reduce((s,ch) => s+(+d[ch.id].power||0), 0)
    }].slice(-30));
    setData(d);
    setLastUpdate(new Date().toLocaleTimeString());
  }, []);

  useEffect(() => {
    demoTimer.current = setInterval(tickDemo, 2000);
    try {
      const meterRef = ref(db, "meter");
      onValue(meterRef, snap => {
        const val = snap.val();
        if (val && val.A1 && (+val.A1.current > 0 || +val.A1.power > 0)) {
          useDemoRef.current = false;
          clearInterval(demoTimer.current);
          setData(val);
          setConnected(true);
          setLastUpdate(new Date().toLocaleTimeString());
        }
      });
    } catch(e) {}
    return () => clearInterval(demoTimer.current);
  }, [tickDemo]);

  const toggleRelay = (channelId, currentStatus) => {
    const newStatus = currentStatus === 1 ? 0 : 1;
    setData(prev => ({...prev, [channelId]: {...prev[channelId], status: newStatus}}));
    try { set(ref(db, `meter/${channelId}/status`), newStatus); } catch(e) {}
  };

  const totalWatts      = CHANNELS.reduce((s,ch) => s+(+data[ch.id]?.power||0), 0);
  const totalEnergyKWh  = CHANNELS.reduce((s,ch) => s+((+data[ch.id]?.power||0)*runtimeHours)/1000, 0);
  const dailyCost       = totalEnergyKWh * tariff;
  const monthlyCost     = dailyCost * 30;
  const yearlyCost      = dailyCost * 365;

  const runAIAnalysis = async () => {
    setAiLoading(true);
    setAiError("");
    setAiAnalysis("");
    const recentHistory = history.slice(-15);
    const avgTotal = recentHistory.length
      ? (recentHistory.reduce((s,h)=>s+h.total,0)/recentHistory.length).toFixed(1)
      : totalWatts.toFixed(1);
    const trend = recentHistory.length >= 3
      ? recentHistory[recentHistory.length-1].total > recentHistory[0].total ? "INCREASING" : "DECREASING"
      : "STABLE";
    const channelSummary = CHANNELS.map(ch => {
      const watts = +data[ch.id]?.power || 0;
      const status = data[ch.id]?.status === 1 ? "ON" : "OFF";
      const costMonth = ((watts*runtimeHours*30)/1000*tariff).toFixed(0);
      return `${ch.label}(${ch.id}): ${watts}W, ${status}, Monthly=Rs.${costMonth}`;
    }).join("\n");
    const prompt = `You are an AI energy analyst for VoltIQ smart energy meter.
Analyze this data and give actionable insights:

LIVE READINGS:
${channelSummary}

TOTAL LOAD: ${totalWatts.toFixed(1)}W
AVERAGE LOAD: ${avgTotal}W
POWER TREND: ${trend}
TARIFF: Rs.${tariff}/kWh
DAILY HOURS: ${runtimeHours}h
MONTHLY BILL ESTIMATE: Rs.${monthlyCost.toFixed(0)}
YEARLY BILL ESTIMATE: Rs.${yearlyCost.toFixed(0)}

Give a concise report with these sections:
1. TREND ANALYSIS - What is happening with power right now
2. TOP ENERGY HOGS - Which devices cost the most
3. SAVINGS TIPS - 3 specific tips to reduce bill
4. SMART SCHEDULE - Best times to run high-power devices  
5. BILL FORECAST - Expected monthly bill assessment

Be specific with numbers. Use Rs. for currency. Keep it friendly and practical.`;
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const result = await response.json();
      if (result.content && result.content[0]?.text) {
        setAiAnalysis(result.content[0].text);
      } else {
        setAiError("No response from AI. Please try again.");
      }
    } catch(e) {
      setAiError("AI unavailable. This feature works when deployed on claude.ai.");
    }
    setAiLoading(false);
  };

  const TABS = [
    { id: "dashboard", label: "HOME",    icon: "⚡" },
    { id: "ai",        label: "AI",      icon: "AI"  },
    { id: "bill",      label: "BILL",    icon: "Rs"  },
    { id: "history",   label: "HISTORY", icon: "~"   },
  ];

  const cardStyle = {
    background: "#0d1424",
    border: "1.5px solid #1a2235",
    borderRadius: 16,
    overflow: "hidden",
    marginBottom: 12,
  };

  const sectionTitle = {
    fontSize: 13,
    fontWeight: 800,
    color: "#fff",
    marginBottom: 12,
    letterSpacing: "0.05em",
  };

  return (
    <main style={{ minHeight: "100vh", background: "#080c14", color: "#e8e8f0", fontFamily: "'Segoe UI', system-ui, sans-serif", paddingBottom: 80 }}>

      {/* HEADER */}
      <div style={{ background: "#0d1424", borderBottom: "2px solid #1e3a5a", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, background: "linear-gradient(135deg,#00d4ff,#0070f3)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#fff" }}>V</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", lineHeight: 1 }}>VoltIQ</div>
            <div style={{ fontSize: 10, color: "#7a9abc", letterSpacing: "0.12em" }}>SMART ENERGY METER</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "#7a9abc" }}>TOTAL</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: totalWatts > 2000 ? "#ff4d4d" : "#00d4ff", lineHeight: 1 }}>{totalWatts.toFixed(0)}W</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: connected ? "#061a10" : "#1a1205", border: `1.5px solid ${connected ? "#00aa55" : "#886600"}`, borderRadius: 20, padding: "5px 12px", fontSize: 11, fontWeight: 800, color: connected ? "#00cc66" : "#ffbb00" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "#00cc66" : "#ffbb00", boxShadow: `0 0 6px ${connected ? "#00cc66" : "#ffbb00"}` }} />
            {connected ? "LIVE" : "DEMO"}
          </div>
        </div>
      </div>

      {/* UPDATE BAR */}
      <div suppressHydrationWarning style={{ background: "#0a0e1a", padding: "4px 20px", fontSize: 10, color: "#4a6a8a", borderBottom: "1px solid #1a2a3a" }}>
        <span suppressHydrationWarning>Updated: {lastUpdate}</span>
        {!connected && <span style={{ color: "#ffbb00", marginLeft: 10 }}>Demo mode — connect ESP32 to go LIVE</span>}
      </div>

      {/* OVERLOAD ALERTS */}
      {CHANNELS.filter(ch => (+data[ch.id]?.power||0) > OVERLOAD_THRESHOLD && !dismissedAlarms.includes(ch.id)).map(ch => (
        <div key={ch.id} style={{ background: "#2a0a0a", borderBottom: "2px solid #ff4444", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#ff6666" }}>OVERLOAD — {ch.id} ({ch.label})</div>
            <div style={{ fontSize: 11, color: "#cc4444" }}>{(+data[ch.id]?.power||0).toFixed(0)}W exceeds {OVERLOAD_THRESHOLD}W limit</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => toggleRelay(ch.id, 1)} style={{ background: "#ff2222", border: "none", borderRadius: 7, color: "#fff", padding: "7px 14px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>TURN OFF</button>
            <button onClick={() => setDismissedAlarms(p=>[...p,ch.id])} style={{ background: "#2a1a1a", border: "1px solid #553333", borderRadius: 7, color: "#cc6666", padding: "7px 12px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>DISMISS</button>
          </div>
        </div>
      ))}

      <div style={{ padding: "16px 16px 8px", maxWidth: 720, margin: "0 auto" }}>

        {/* ══ HOME TAB ══ */}
        {activeTab === "dashboard" && (<>
          {/* Summary row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
            {[
              { label: "DAILY COST",   value: `Rs.${dailyCost.toFixed(2)}`,   color: "#fbbf24" },
              { label: "MONTHLY EST.", value: `Rs.${monthlyCost.toFixed(0)}`, color: "#34d399" },
            ].map(s => (
              <div key={s.label} style={{ background: "#0d1424", border: "1px solid #1e3050", borderRadius: 12, padding: "12px 14px", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "#7a9abc", letterSpacing: "0.1em", marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Channel cards */}
          {CHANNELS.map(ch => {
            const d = data[ch.id] || { current:0, voltage:230, power:0, status:0 };
            const isOn = d.status === 1;
            const pct = Math.min((+d.power||0)/3000, 1);
            const isOver = (+d.power||0) > OVERLOAD_THRESHOLD;
            const costMonth = ((+d.power||0)*runtimeHours*30/1000*tariff).toFixed(0);
            return (
              <div key={ch.id} style={{ ...cardStyle, border: `1.5px solid ${isOver?"#ff444466":isOn?ch.color+"44":"#1a2235"}`, boxShadow: isOver?"0 0 20px #ff222215":isOn?`0 0 14px ${ch.color}10`:"none" }}>
                {/* Header */}
                <div style={{ padding: "14px 16px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", background: isOver?"#ff22220a":isOn?ch.color+"07":"transparent", borderBottom: `1px solid ${isOver?"#ff444422":isOn?ch.color+"22":"#1a2235"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: ch.color+"22", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: ch.color, letterSpacing: "0.05em" }}>{ch.icon}</div>
                    <div>
                      <div style={{ fontSize: 10, color: "#7a9abc", letterSpacing: "0.1em" }}>{ch.id}{isOver&&<span style={{ color:"#ff6666", marginLeft:6, fontSize:9 }}>OVERLOAD</span>}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{ch.label}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 9, color: "#7a9abc" }}>EST./MONTH</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#34d399" }}>Rs.{costMonth}</div>
                    </div>
                    <button onClick={() => toggleRelay(ch.id, d.status)} style={{ background: isOn?ch.color:"#1a2235", border: `2px solid ${isOn?ch.color:"#2a3555"}`, borderRadius: 8, color: isOn?"#000":"#7a9abc", padding: "8px 18px", fontSize: 13, cursor: "pointer", fontWeight: 800, transition: "all 0.2s", minWidth: 60 }}>
                      {isOn ? "ON" : "OFF"}
                    </button>
                  </div>
                </div>
                {/* Metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1px", background: "#111827" }}>
                  {[
                    { label:"CURRENT", value:(+d.current||0).toFixed(2), unit:"A", color:"#fbbf24" },
                    { label:"VOLTAGE", value:(+d.voltage||0).toFixed(1),  unit:"V", color:"#60a5fa" },
                    { label:"POWER",   value:(+d.power||0).toFixed(1),    unit:"W", color:isOver?"#ff6666":"#34d399" },
                  ].map(m => (
                    <div key={m.label} style={{ background:"#0d1424", padding:"12px 8px", textAlign:"center" }}>
                      <div style={{ fontSize:9, color:"#5a7a9a", letterSpacing:"0.08em", marginBottom:4, fontWeight:700 }}>{m.label}</div>
                      <div style={{ fontSize:18, fontWeight:800, color:m.color, lineHeight:1 }}>
                        {m.value}<span style={{ fontSize:10, color:"#5a7a9a", marginLeft:1 }}>{m.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Load bar */}
                <div style={{ padding:"10px 16px 12px", background:"#0d1424" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:9, color:"#5a7a9a", marginBottom:5, fontWeight:700, letterSpacing:"0.08em" }}>
                    <span>LOAD</span>
                    <span style={{ color:isOver?"#ff6666":pct>0.5?"#fbbf24":"#5a7a9a" }}>{(pct*100).toFixed(0)}%{isOver?" OVERLOAD":""}</span>
                  </div>
                  <div style={{ height:4, background:"#111827", borderRadius:4, overflow:"hidden" }}>
                    <div style={{ height:"100%", width:`${pct*100}%`, background:isOver?"#ff4444":pct>0.8?"#f87171":pct>0.5?"#fbbf24":ch.color, borderRadius:4, transition:"width 0.5s" }} />
                  </div>
                  <div style={{ marginTop:6, fontSize:9, color:"#4a6a8a", letterSpacing:"0.06em" }}>
                    SESSION ENERGY: <span style={{ color:"#6a9abc" }}>{(energyLog[ch.id]||0).toFixed(4)} kWh</span>
                  </div>
                </div>
              </div>
            );
          })}
        </>)}

        {/* ══ AI TAB ══ */}
        {activeTab === "ai" && (
          <div>
            {/* AI Hero card */}
            <div style={{ background:"linear-gradient(135deg,#0d1f3a,#1a0d3a)", border:"2px solid #3b2a6a", borderRadius:18, padding:"20px", marginBottom:14, textAlign:"center" }}>
              <div style={{ width:56, height:56, background:"linear-gradient(135deg,#7c3aed,#4f46e5)", borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:900, color:"#fff", margin:"0 auto 12px", letterSpacing:"0.05em" }}>AI</div>
              <div style={{ fontSize:18, fontWeight:800, color:"#a78bfa", marginBottom:6 }}>AI Energy Analyst</div>
              <div style={{ fontSize:12, color:"#7a9abc", lineHeight:1.6, marginBottom:16 }}>
                Powered by Claude AI. Analyzes your live energy data and gives smart recommendations to save money and reduce consumption.
              </div>
              {/* Stats row */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:16 }}>
                {[
                  { label:"LOAD",         value:`${totalWatts.toFixed(0)}W`,     color:"#00d4ff" },
                  { label:"MONTHLY BILL", value:`Rs.${monthlyCost.toFixed(0)}`,  color:"#34d399" },
                  { label:"DATA PTS",     value:`${history.length}`,             color:"#a78bfa" },
                ].map(s => (
                  <div key={s.label} style={{ background:"#080c14", borderRadius:10, padding:"10px 6px" }}>
                    <div style={{ fontSize:8, color:"#7a9abc", marginBottom:3, letterSpacing:"0.1em" }}>{s.label}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <button
                onClick={runAIAnalysis}
                disabled={aiLoading}
                style={{ background:aiLoading?"#2a1a4a":"linear-gradient(135deg,#7c3aed,#4f46e5)", border:"none", borderRadius:12, color:"#fff", padding:"14px 0", fontSize:14, cursor:aiLoading?"not-allowed":"pointer", fontWeight:800, letterSpacing:"0.06em", width:"100%", opacity:aiLoading?0.7:1, transition:"all 0.2s" }}
              >
                {aiLoading ? "ANALYSING YOUR DATA..." : "RUN AI ANALYSIS"}
              </button>
            </div>

            {/* Error */}
            {aiError && (
              <div style={{ background:"#2a0a0a", border:"1px solid #ff4444", borderRadius:12, padding:"14px 16px", marginBottom:14, fontSize:13, color:"#ff6666" }}>
                {aiError}
              </div>
            )}

            {/* AI Result */}
            {aiAnalysis && (
              <div style={{ background:"#0d1424", border:"2px solid #3b2a6a", borderRadius:18, padding:"18px", marginBottom:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, paddingBottom:12, borderBottom:"1px solid #1e3050" }}>
                  <div style={{ width:32, height:32, background:"linear-gradient(135deg,#7c3aed,#4f46e5)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:"#fff" }}>AI</div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:800, color:"#a78bfa" }}>AI Analysis Report</div>
                    <div style={{ fontSize:10, color:"#7a9abc" }}>Generated from live sensor data</div>
                  </div>
                </div>
                <div style={{ fontSize:13, color:"#c8d8e8", lineHeight:1.9, whiteSpace:"pre-wrap" }}>{aiAnalysis}</div>
              </div>
            )}

            {/* Feature list */}
            {!aiAnalysis && !aiLoading && (
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {[
                  { icon:"TRD", title:"Trend Analysis",    desc:"Detects if power usage is rising or falling over time", color:"#00d4ff" },
                  { icon:"Rs",  title:"Bill Forecasting",  desc:"Predicts your monthly bill based on current usage",     color:"#34d399" },
                  { icon:"TIP", title:"Savings Tips",      desc:"Device-specific recommendations to cut electricity cost",color:"#fbbf24" },
                  { icon:"SCH", title:"Smart Schedule",    desc:"Best times to run high-power appliances",               color:"#a78bfa" },
                  { icon:"ALT", title:"Anomaly Detection", desc:"Flags unusual power spikes and wasteful consumption",    color:"#fb923c" },
                ].map(f => (
                  <div key={f.title} style={{ background:"#0d1424", border:"1px solid #1e3050", borderRadius:12, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
                    <div style={{ width:40, height:40, borderRadius:10, background:f.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:f.color, flexShrink:0, letterSpacing:"0.03em" }}>{f.icon}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff", marginBottom:3 }}>{f.title}</div>
                      <div style={{ fontSize:11, color:"#7a9abc", lineHeight:1.5 }}>{f.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ══ BILL TAB ══ */}
        {activeTab === "bill" && (
          <div>
            {/* Settings */}
            <div style={{ ...cardStyle, padding:"18px" }}>
              <div style={sectionTitle}>BILLING SETTINGS</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                <div>
                  <label style={{ fontSize:10, color:"#7a9abc", fontWeight:700, display:"block", marginBottom:6, letterSpacing:"0.1em" }}>TARIFF (Rs./kWh)</label>
                  <input type="number" value={tariff} min={1} max={50} step={0.5}
                    onChange={e=>setTariff(+e.target.value||1)}
                    style={{ background:"#111827", border:"2px solid #1e3a5a", borderRadius:8, color:"#fff", padding:"10px 12px", fontSize:18, fontWeight:700, width:"100%", outline:"none", boxSizing:"border-box" }} />
                  <div style={{ fontSize:9, color:"#4a6a8a", marginTop:4 }}>Mumbai avg: Rs.8-12</div>
                </div>
                <div>
                  <label style={{ fontSize:10, color:"#7a9abc", fontWeight:700, display:"block", marginBottom:6, letterSpacing:"0.1em" }}>HOURS / DAY</label>
                  <input type="number" value={runtimeHours} min={1} max={24} step={1}
                    onChange={e=>setRuntimeHours(+e.target.value||1)}
                    style={{ background:"#111827", border:"2px solid #1e3a5a", borderRadius:8, color:"#fff", padding:"10px 12px", fontSize:18, fontWeight:700, width:"100%", outline:"none", boxSizing:"border-box" }} />
                  <div style={{ fontSize:9, color:"#4a6a8a", marginTop:4 }}>Daily usage hours</div>
                </div>
              </div>
            </div>

            {/* Per channel */}
            <div style={sectionTitle}>PER CHANNEL ESTIMATE</div>
            {CHANNELS.map(ch => {
              const watts = +data[ch.id]?.power || 0;
              const costDay   = (watts*runtimeHours/1000*tariff);
              const costMonth = costDay * 30;
              return (
                <div key={ch.id} style={{ ...cardStyle, padding:"14px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ width:36, height:36, borderRadius:8, background:ch.color+"22", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:900, color:ch.color }}>{ch.icon}</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color:"#fff" }}>{ch.label}</div>
                      <div style={{ fontSize:11, color:ch.color, fontWeight:600 }}>{watts.toFixed(0)}W</div>
                    </div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontSize:10, color:"#7a9abc", marginBottom:2 }}>Daily / Monthly</div>
                    <div style={{ fontSize:13, fontWeight:800 }}>
                      <span style={{ color:"#fbbf24" }}>Rs.{costDay.toFixed(2)}</span>
                      <span style={{ color:"#3a5a7a", margin:"0 5px" }}>/</span>
                      <span style={{ color:"#34d399" }}>Rs.{costMonth.toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Summary */}
            <div style={{ background:"linear-gradient(135deg,#0d1f3a,#0d2a1a)", border:"2px solid #1e5a3a", borderRadius:16, padding:"20px", marginTop:4 }}>
              <div style={{ ...sectionTitle, marginBottom:16 }}>TOTAL BILL SUMMARY</div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
                {[
                  { label:"DAILY",   value:`Rs.${dailyCost.toFixed(2)}`,   color:"#fbbf24" },
                  { label:"MONTHLY", value:`Rs.${monthlyCost.toFixed(0)}`, color:"#34d399" },
                  { label:"YEARLY",  value:`Rs.${yearlyCost.toFixed(0)}`,  color:"#a78bfa" },
                ].map(s => (
                  <div key={s.label} style={{ textAlign:"center", background:"#08111a", borderRadius:10, padding:"12px 6px" }}>
                    <div style={{ fontSize:9, color:"#5a7a9a", letterSpacing:"0.1em", marginBottom:6, fontWeight:700 }}>{s.label}</div>
                    <div style={{ fontSize:18, fontWeight:900, color:s.color, lineHeight:1 }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop:12, fontSize:10, color:"#5a7a9a", lineHeight:1.7 }}>
                Based on {runtimeHours}h/day at Rs.{tariff}/kWh — Total load: {totalWatts.toFixed(0)}W — {totalEnergyKWh.toFixed(2)} kWh/day
              </div>
            </div>
          </div>
        )}

        {/* ══ HISTORY TAB ══ */}
        {activeTab === "history" && (
          <div>
            <div style={sectionTitle}>POWER HISTORY — {history.length} readings</div>

            {/* Bar chart */}
            <div style={{ ...cardStyle, padding:"16px" }}>
              <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:100, marginBottom:8 }}>
                {history.length === 0 && <div style={{ color:"#7a9abc", fontSize:12, alignSelf:"center", margin:"auto" }}>Collecting data... wait a few seconds</div>}
                {history.map((h,i) => {
                  const maxW = Math.max(...history.map(x=>x.total), 1);
                  const p = h.total/maxW;
                  return <div key={i} title={`${h.time}: ${h.total.toFixed(0)}W`} style={{ flex:"1 0 6px", minWidth:6, height:`${Math.max(p*100,3)}%`, background:p>0.8?"#ff4444":p>0.5?"#fbbf24":"#00d4ff", borderRadius:"2px 2px 0 0", opacity:i===history.length-1?1:0.55, transition:"height 0.3s" }} />;
                })}
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:"#4a6a8a" }}>
                <span>oldest</span><span>latest: {totalWatts.toFixed(0)}W</span>
              </div>
            </div>

            {/* Channel bars */}
            <div style={{ ...cardStyle, padding:"16px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#fff", marginBottom:14 }}>CHANNEL BREAKDOWN</div>
              {CHANNELS.map(ch => {
                const w = +data[ch.id]?.power || 0;
                return (
                  <div key={ch.id} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, marginBottom:4, fontWeight:600 }}>
                      <span style={{ color:ch.color }}>{ch.label}</span>
                      <span style={{ color:"#fff" }}>{w.toFixed(0)}W</span>
                    </div>
                    <div style={{ height:7, background:"#111827", borderRadius:4, overflow:"hidden" }}>
                      <div style={{ height:"100%", width:`${Math.min(w/3000,1)*100}%`, background:ch.color, borderRadius:4, transition:"width 0.5s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Table */}
            <div style={{ ...cardStyle, padding:"16px", overflowX:"auto" }}>
              <div style={{ fontSize:12, fontWeight:700, color:"#fff", marginBottom:12 }}>RECENT READINGS</div>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11, minWidth:300 }}>
                <thead>
                  <tr style={{ background:"#111827" }}>s
                    {["Time","A1","A2","A3","A4","Total"].map(h=>(
                      <th key={h} style={{ padding:"8px 10px", textAlign:"left", color:"#7a9abc", fontWeight:700, borderBottom:"1px solid #1e3050" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...history].reverse().slice(0,10).map((r,i)=>(
                    <tr key={i} style={{ borderBottom:"1px solid #1a2235" }}>
                      <td style={{ padding:"7px 10px", color:"#5a7a9a" }}>{r.time}</td>
                      {CHANNELS.map(ch=>(
                        <td key={ch.id} style={{ padding:"7px 10px", color:ch.color, fontWeight:600 }}>{(r[ch.id]||0).toFixed(0)}</td>
                      ))}
                      <td style={{ padding:"7px 10px", color:"#00d4ff", fontWeight:700 }}>{(r.total||0).toFixed(0)}</td>
                    </tr>
                  ))}
                  {history.length===0&&<tr><td colSpan={6} style={{ padding:"20px", textAlign:"center", color:"#5a7a9a" }}>No data yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#0d1424", borderTop:"2px solid #1e3a5a", display:"flex", zIndex:200 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"10px 4px 8px", background:"none", border:"none", cursor:"pointer", gap:3, transition:"all 0.2s", outline:"none" }}
          >
            <div style={{ width:32, height:32, borderRadius:8, background:activeTab===tab.id?"#0070f322":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:activeTab===tab.id?13:12, fontWeight:900, color:activeTab===tab.id?"#00d4ff":"#4a6a8a", letterSpacing:"0.05em", transition:"all 0.2s" }}>
              {tab.icon}
            </div>
            <span style={{ fontSize:9, fontWeight:700, color:activeTab===tab.id?"#00d4ff":"#4a6a8a", letterSpacing:"0.08em" }}>{tab.label}</span>
            {activeTab===tab.id && <div style={{ width:20, height:2, background:"#00d4ff", borderRadius:2 }} />}
          </button>
        ))}
      </div>

      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; padding: 0; }
      `}</style>
    </main>
  );
}