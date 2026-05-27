import React, { useState, useMemo, useEffect } from 'react';
import { Calendar, Hammer, Users, MessageSquare, Clock, DollarSign, Package, Plus, ChevronLeft, ChevronRight, Search, AlertTriangle, CheckCircle2, Truck, Send, X, MapPin, User, Eye, EyeOff, LogOut, Home, Wrench, FileText, ShieldCheck, ShieldAlert, Loader2, Navigation, Camera, Receipt, Upload, Sparkles, ChevronDown, ChevronUp, Wallet, TrendingUp, TrendingDown, Coffee } from 'lucide-react';
import { deleteEntity, isMissingLiveTablesError, loadLiveData, upsertEntity } from './src/lib/liveDataStore';

// ============================================================
// QUEST — Job Command Center
// On a quest to serve you better.
// ============================================================

// ---------- ROLES & PERMISSIONS ----------
const ROLES = {
  OWNER:    { id: 'owner',    label: 'Owner',          name: 'Abraham',        canSeePay: true,  canSeeBurn: true,  canEdit: true,  canLogOthers: true  },
  COOWNER:  { id: 'coowner',  label: 'Co-Owner',       name: 'Alkeith Cabezzas',canSeePay: true, canSeeBurn: true,  canEdit: true,  canLogOthers: true  },
  MANAGER:  { id: 'manager',  label: 'Office Manager', name: 'Maria',          canSeePay: true,  canSeeBurn: true,  canEdit: true,  canLogOthers: true  },
  FOREMAN:  { id: 'foreman',  label: 'Foreman',        name: 'Jesus',          canSeePay: true,  canSeeBurn: true,  canEdit: true,  canLogOthers: false },
  CREW:     { id: 'crew',     label: 'Field Worker',   name: 'Carlos',         canSeePay: false, canSeeBurn: false, canEdit: false, canLogOthers: false },
};

// ---------- SEED DATA ----------
const SEED_JOBS = [];

const SEED_TEAM = [];

// Format pay rate for display
const fmtPayRate = (m) => {
  if (m.payType === 'hourly') return `$${m.payAmount}/hr`;
  if (m.payType === 'daily') return `$${m.payAmount}/day`;
  if (m.payType === 'salary') return `$${m.payAmount}/wk`;
  return '—';
};

// Calculate what's owed for given hours/days worked
const calcPay = (member, hoursWorked, daysWorked) => {
  if (member.payType === 'hourly') return member.payAmount * hoursWorked;
  if (member.payType === 'daily') return member.payAmount * daysWorked;
  if (member.payType === 'salary') return member.payAmount; // weekly salary, flat
  return 0;
};

// Calculate the labor cost of a SPECIFIC entry, allocated to the SPECIFIC job that entry was for.
// For daily/salary workers, this prorates the day's flat pay by hours-on-this-job ÷ total-hours-that-day.
// allEntriesForWorkerThatDay = all that worker's entries on that date (for proration math)
const entryCostOnJob = (member, entry, allEntriesForWorkerThatDay) => {
  if (!member) return 0;
  if (member.payType === 'hourly') return member.payAmount * entry.hours;
  // Daily / salary: prorate the day's pay across that day's jobs by hours
  const totalHoursThatDay = allEntriesForWorkerThatDay.reduce((s, e) => s + e.hours, 0);
  if (totalHoursThatDay === 0) return 0;
  const dayPay = member.payType === 'daily' ? member.payAmount : (member.payAmount / 5);
  return dayPay * (entry.hours / totalHoursThatDay);
};

const SEED_TIMELOG = [];

const SEED_EXPENSES = [];

// Payment method labels + colors
const PAYMENT_METHOD = {
  'cod-cash':       { label: 'COD — Cash',     short: 'CASH',   color: '#4ade80' },
  'cod-card':       { label: 'COD — Card',     short: 'CARD',   color: '#60a5fa' },
  'credit-account': { label: 'Credit Account', short: 'CREDIT', color: '#a78bfa' },
  'check':          { label: 'Check',          short: 'CHECK',  color: '#fb923c' },
  'other':          { label: 'Other',          short: 'OTHER',  color: '#888' },
};


const SEED_MESSAGES = [];

// ---------- THEME ----------
const T = {
  bg: '#0a0a0a',
  panel: '#141414',
  panel2: '#1a1a1a',
  border: '#262626',
  borderHi: '#333',
  text: '#e8e8e8',
  textDim: '#888',
  textMute: '#555',
  accent: '#ED4E0D',      // Quest orange — pulled from logo
  accentDk: '#B53A08',
  accentLt: '#F5510E',
  green: '#4ade80',
  red: '#ef4444',
  blue: '#60a5fa',
  purple: '#a78bfa',
  yellow: '#facc15',
};

// Margin health tiers — use everywhere we display a projected/live profit %
// Returns { color, label, warning } based on margin percentage
const marginTier = (pct) => {
  if (pct >= 35)  return { color: '#4ade80', label: 'HEALTHY',     warning: null };
  if (pct >= 20)  return { color: '#ED4E0D', label: 'ACCEPTABLE',  warning: null };
  if (pct >= 10)  return { color: '#facc15', label: 'WARNING',     warning: 'Thin margin — review budgets' };
  if (pct > 0)    return { color: '#ef4444', label: 'BAD',         warning: 'Margin below 10% — likely unprofitable' };
  return            { color: '#ef4444', label: 'UNPROFITABLE', warning: 'Job is unprofitable as-budgeted' };
};

// ---------- STATUS PILL ----------
// "active" jobs split into two display states based on real-time clock-ins:
//   - ON SITE: someone is clocked in right now → green
//   - PAUSED: job started but nobody on the clock today → amber
// `scheduled` = not started yet · `complete` = finished · `delayed` = behind schedule
const STATUS_STYLE = {
  'active':      { bg: T.green,  fg: '#000', label: 'ON SITE' },     // overridden in getJobDisplayStatus when paused
  'on-site':     { bg: T.green,  fg: '#000', label: 'ON SITE' },     // legacy alias
  'in-progress': { bg: T.accent, fg: '#000', label: 'IN PROGRESS' }, // legacy alias
  'paused':      { bg: T.accent, fg: '#000', label: 'PAUSED' },
  'pending-schedule': { bg: T.purple, fg: '#000', label: 'NEEDS SCHEDULING' },
  'scheduled':   { bg: '#404040', fg: '#fff', label: 'SCHEDULED' },
  'complete':    { bg: T.blue,   fg: '#000', label: 'COMPLETE' },
  'delayed':     { bg: T.red,    fg: '#fff', label: 'DELAYED' },
};

// Returns the EFFECTIVE status of a job, factoring in whether anyone is currently clocked in.
// timelog: full time log array; today: ISO date string for "now"
const getJobDisplayStatus = (job, timelog, today) => {
  // Manual states win — if you marked it complete/delayed/scheduled/pending-schedule, that's what it is
  if (job.status === 'complete' || job.status === 'delayed' || job.status === 'scheduled' || job.status === 'pending-schedule') {
    return job.status;
  }
  // For active jobs: check if anyone is clocked in right now
  const anyoneOnSite = (timelog || []).some(t => t.jobId === job.id && t.date === today && !t.clockOut);
  return anyoneOnSite ? 'on-site' : 'paused';
};

const MAT_STYLE = {
  delivered:   { color: T.green,  icon: CheckCircle2, label: 'DELIVERED' },
  'in-transit':{ color: T.accent, icon: Truck,        label: 'IN TRANSIT' },
  ordered:     { color: T.blue,   icon: Package,      label: 'ORDERED' },
  pending:     { color: T.red,    icon: AlertTriangle,label: 'PENDING' },
  partial:     { color: T.accent, icon: AlertTriangle,label: 'PARTIAL' },
};

// ---------- HELPERS ----------
const DEMO_TODAY = '2026-04-29';
const TIME_CLOCK_TASKS = [
  'Tear-off',
  'Dry-in / underlayment',
  'Shingle install',
  'TPO install',
  'Framing / carpentry',
  'Material pickup',
  'Cleanup',
  'Inspection / punch list',
];

const fmtMoney = (n) => '$' + Math.round(n).toLocaleString();
const parseDate = (s) => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
const isoDate = (d) => d.toISOString().slice(0,10);
const sameDay = (a, b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
const inRange = (d, start, end) => d >= start && d <= end;

const fmtTime = (d = new Date()) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const parseClockTime = (value) => {
  if (!value) return null;
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const meridiem = (m[3] || '').toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours + minutes / 60;
};

const clockHoursBetween = (start, end) => {
  const startHours = parseClockTime(start);
  const endHours = parseClockTime(end);
  if (startHours === null || endHours === null) return 0;
  const adjustedEnd = endHours < startHours ? endHours + 24 : endHours;
  return Math.max(0, adjustedEnd - startHours);
};

const breakHours = (breaks = []) => breaks.reduce((sum, b) => {
  if (!b.start || !b.end) return sum;
  return sum + clockHoursBetween(b.start, b.end);
}, 0);

const payableHours = (clockIn, clockOut, breaks = []) => {
  if (!clockIn || !clockOut) return 0;
  return Math.round(Math.max(0, clockHoursBetween(clockIn, clockOut) - breakHours(breaks)) * 10) / 10;
};

const useStoredState = (key, initialValue) => {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can fail in private browsing or locked-down webviews; keep the in-memory state.
    }
  }, [key, value]);

  return [value, setValue];
};

const LiveDataStatus = ({ status, error }) => {
  if (status === 'connected') return null;

  const isSetupNeeded = status === 'setup-needed';
  const color = isSetupNeeded ? T.accent : status === 'loading' ? T.blue : T.red;
  const label = status === 'loading' ? 'CONNECTING TO SUPABASE' : isSetupNeeded ? 'SUPABASE SETUP NEEDED' : 'CACHE-ONLY MODE';
  const message = status === 'loading'
    ? 'Loading live company data...'
    : isSetupNeeded
      ? 'Run supabase/sql/002_beta_anon_persistence.sql in the Supabase SQL Editor, then refresh.'
      : (error?.message || 'Live sync failed. Changes will stay in this browser cache until Supabase is reachable.');

  return (
    <div style={{ background: T.panel, borderBottom: `1px solid ${T.border}`, padding: '8px 20px', color: T.text, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, letterSpacing: 1 }}>
      {status === 'loading' ? <Loader2 size={13} style={{ color }} /> : <AlertTriangle size={13} style={{ color }} />}
      <span style={{ color, fontWeight: 800 }}>{label}</span>
      <span style={{ color: T.textDim, letterSpacing: 0 }}>{message}</span>
    </div>
  );
};

// Haversine distance in miles between two lat/lng points
const distanceMiles = (lat1, lng1, lat2, lng2) => {
  const R = 3958.8; // earth radius in miles
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Get current GPS location, returns Promise<{lat, lng, accuracy}>
const getCurrentLocation = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) {
    reject(new Error('Geolocation not supported on this device'));
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
    (err) => reject(new Error(err.code === 1 ? 'Location permission denied' : 'Could not get location')),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

// ============================================================
// LOGIN / ROLE SWITCHER
// ============================================================
function LoginScreen({ onPick }) {
  const roles = Object.values(ROLES);
  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>
            <span style={{ color: T.accent }}>Q</span><span style={{ color: T.text }}>UEST</span>
          </div>
          <div style={{ fontSize: 13, letterSpacing: 4, color: T.accent, fontWeight: 700, marginTop: 8, borderTop: `2px solid ${T.accent}`, paddingTop: 8, display: 'inline-block', paddingLeft: 16, paddingRight: 16 }}>CONSTRUCTION & ROOFING</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 14 }}>JOB COMMAND CENTER</div>
          <div style={{ fontSize: 14, color: T.textDim, marginTop: 6, fontStyle: 'italic' }}>On a quest to serve you better.</div>
        </div>
        <div style={{ fontSize: 13, letterSpacing: 2, color: T.textDim, marginBottom: 12, fontWeight: 700 }}>SIGN IN AS</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {roles.map(r => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              style={{
                background: T.panel, border: `1px solid ${T.border}`, borderLeft: `4px solid ${r.id==='owner' || r.id==='coowner' ? T.accent : r.id==='manager' ? T.blue : r.id==='foreman' ? T.green : T.textMute}`,
                padding: '14px 18px', cursor: 'pointer', textAlign: 'left', color: T.text,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = T.panel2}
              onMouseLeave={e => e.currentTarget.style.background = T.panel}
            >
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{r.name}</div>
                <div style={{ fontSize: 13, color: T.textDim, letterSpacing: 1, marginTop: 2 }}>{r.label.toUpperCase()}</div>
              </div>
              <div style={{ fontSize: 12, color: r.canSeePay ? T.green : T.textMute, letterSpacing: 1 }}>
                {r.canSeePay ? '● $$ ACCESS' : '○ NO $$ ACCESS'}
              </div>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: T.textMute, marginTop: 18, textAlign: 'center', letterSpacing: 1 }}>
          LIVE SETUP — TEMPORARY ROLE PREVIEW UNTIL SUPABASE AUTH IS ENABLED
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SHARED — TOP BAR
// ============================================================
function TopBar({ role, onLogout, view, setView, openEntry, onOpenTimeClock }) {
  const tabs = [
    { id: 'dash',     label: 'DASHBOARD', icon: Home },
    { id: 'jobs',     label: 'JOBS',      icon: Hammer },
    { id: 'cal',      label: 'CALENDAR',  icon: Calendar },
    { id: 'lookahead',label: '2-WEEK',    icon: Clock },
    { id: 'team',     label: 'TEAM',      icon: Users },
    { id: 'time',     label: 'TIME CLOCK', icon: Clock },
    { id: 'expenses', label: 'EXPENSES',  icon: Receipt, gated: 'canSeeBurn' },
    { id: 'payroll',  label: 'PAYROLL',   icon: Wallet,  gated: 'canSeePay' },
    { id: 'completed',label: 'FINANCIALS', icon: TrendingUp, gated: 'canSeeBurn' },
    { id: 'chat',     label: 'CHAT',      icon: MessageSquare },
  ];
  const visibleTabs = tabs.filter(t => !t.gated || role[t.gated]);
  return (
    <div style={{ background: T.panel, borderBottom: `2px solid ${T.accent}`, position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1 }}>
              <span style={{ color: T.accent }}>Q</span><span style={{ color: T.text }}>UEST</span>
            </div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, marginTop: 2, fontWeight: 700 }}>CONSTRUCTION & ROOFING</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onOpenTimeClock}
            style={{
              background: openEntry ? T.red : T.accent,
              border: 'none',
              color: openEntry ? '#fff' : '#000',
              padding: '8px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 1,
              whiteSpace: 'nowrap',
            }}
          >
            <Clock size={13} /> {openEntry ? 'CLOCK OUT' : 'CLOCK IN'}
          </button>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{role.name}</div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 1 }}>{role.label.toUpperCase()}</div>
          </div>
          <button onClick={onLogout} style={{ background: 'transparent', border: `1px solid ${T.border}`, color: T.textDim, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <LogOut size={12} /> SWITCH
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 0, paddingLeft: 8, overflowX: 'auto' }}>
        {visibleTabs.map(t => {
          const Icon = t.icon;
          const active = view === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              style={{
                background: active ? T.bg : 'transparent',
                border: 'none',
                borderBottom: active ? `2px solid ${T.accent}` : '2px solid transparent',
                color: active ? T.accent : T.textDim,
                padding: '10px 14px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, letterSpacing: 1,
                whiteSpace: 'nowrap',
              }}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// SHARED — STAT CARD
// ============================================================
function StatCard({ label, value, accent, locked, onClick, sub }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: T.panel, borderLeft: `3px solid ${accent}`, padding: '14px 16px', minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = T.panel2; }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.background = T.panel; }}
    >
      <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        {locked && <EyeOff size={11} />} {label}
        {onClick && <span style={{ marginLeft: 'auto', color: T.textMute }}>›</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: locked ? T.textMute : accent, marginTop: 4 }}>
        {locked ? '— — —' : value}
      </div>
      {sub && !locked && <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ============================================================
// VIEW — DASHBOARD
// ============================================================
function Dashboard({ jobs, role, gotoJob, setView, team, timelog, expenses }) {
  const [showTeamPanel, setShowTeamPanel] = useState(false);
  const today = parseDate('2026-04-29');
  const todayStr = '2026-04-29';

  // Active jobs split into two groups based on clock-in state
  const openEntries = timelog.filter(t => t.date === todayStr && !t.clockOut);
  const onSiteJobIds = [...new Set(openEntries.map(t => t.jobId))];
  const onSiteJobs = jobs.filter(j => onSiteJobIds.includes(j.id));
  // Paused = manually-active jobs (or legacy on-site/in-progress) that have nobody clocked in today
  const pausedJobs = jobs.filter(j =>
    (j.status === 'active' || j.status === 'on-site' || j.status === 'in-progress') &&
    !onSiteJobIds.includes(j.id)
  );

  // Workers currently clocked in (unique people, not entries)
  const uniqueWorkersClockedIn = [...new Set(openEntries.map(e => e.worker))];
  const workersClockedIn = uniqueWorkersClockedIn.length;

  // LIVE labor burn: hourly counts hours-so-far, daily/salary counts ONCE per person per day
  // (no double-counting if someone hopped between jobs today)
  const todayEntries = timelog.filter(t => t.date === todayStr);
  const workersToday = [...new Set(todayEntries.map(e => e.worker))];
  const laborBurn = workersToday.reduce((sum, workerName) => {
    const member = team.find(m => m.name === workerName);
    if (!member) return sum;
    const myEntries = todayEntries.filter(e => e.worker === workerName);
    if (member.payType === 'hourly') {
      // Sum actual hours from all entries (closed + estimate 8h prorated for open)
      const hoursSoFar = myEntries.reduce((s, e) => s + (e.hours || (e.clockOut ? 0 : 4)), 0);
      return sum + member.payAmount * hoursSoFar;
    }
    if (member.payType === 'daily') return sum + member.payAmount; // flat once per day
    if (member.payType === 'salary') return sum + (member.payAmount / 5);
    return sum;
  }, 0);

  const materialsBurnToday = expenses
    .filter(e => e.date === todayStr)
    .reduce((s, e) => s + e.total, 0);

  const todayBurn = laborBurn + materialsBurnToday;

  // Week-to-date labor burn (Sunday to today, this week)
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay()); // back to Sunday
  const weekStartStr = isoDate(weekStart);
  const weekEntries = timelog.filter(t => t.date >= weekStartStr && t.date <= todayStr);
  // Group entries by worker+date so daily/salary count once per day
  const weekBurnByWorkerDay = {};
  weekEntries.forEach(e => {
    const key = `${e.worker}|${e.date}`;
    if (!weekBurnByWorkerDay[key]) weekBurnByWorkerDay[key] = [];
    weekBurnByWorkerDay[key].push(e);
  });
  const laborBurnWeek = Object.values(weekBurnByWorkerDay).reduce((sum, dayEntries) => {
    const member = team.find(m => m.name === dayEntries[0].worker);
    if (!member) return sum;
    if (member.payType === 'hourly') {
      const hours = dayEntries.reduce((s, e) => s + (e.hours || 0), 0);
      return sum + member.payAmount * hours;
    }
    if (member.payType === 'daily') return sum + member.payAmount;
    if (member.payType === 'salary') return sum + (member.payAmount / 5);
    return sum;
  }, 0);

  const weekJobs = jobs.filter(j => {
    if (!j.startDate || !j.endDate) return false;
    const s = parseDate(j.startDate), e = parseDate(j.endDate);
    const weekEnd = new Date(today); weekEnd.setDate(today.getDate() + 7);
    return s <= weekEnd && e >= today;
  });

  // Group clocked-in workers by job for the panel
  const teamByJob = {};
  openEntries.forEach(entry => {
    if (!teamByJob[entry.jobId]) teamByJob[entry.jobId] = [];
    teamByJob[entry.jobId].push(entry);
  });

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Today's Operations</div>
          <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>Wednesday · April 29, 2026</div>
        </div>
        <div style={{ fontSize: 13, color: T.green }}>● {onSiteJobs.length} ON SITE · {workersClockedIn} CLOCKED IN</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 22 }}>
        {/* LABOR BURN — week big, today small */}
        {role.canSeeBurn && (
          <div style={{ background: T.panel, padding: 14, borderLeft: `3px solid ${T.accent}` }}>
            <div style={{ fontSize: 12, letterSpacing: 2, color: T.textDim, fontWeight: 700, marginBottom: 4 }}>LABOR BURN</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: T.accent }}>{fmtMoney(laborBurnWeek)}</div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginTop: 2 }}>WEEK TO DATE</div>
            <div style={{ borderTop: `1px solid ${T.border}`, marginTop: 10, paddingTop: 8, fontSize: 18, color: T.text }}>
              Today: <span style={{ color: T.accent, fontWeight: 700 }}>{fmtMoney(laborBurn)}</span>
              <span style={{ color: T.textDim, fontSize: 15 }}> · {workersClockedIn} on the clock</span>
            </div>
          </div>
        )}
        <StatCard label="TEAM OUT" value={`${workersClockedIn} ${workersClockedIn === 1 ? 'PERSON' : 'PEOPLE'}`} accent={T.green}
                  sub={`${onSiteJobs.length} of ${jobs.length} jobs`}
                  onClick={() => setShowTeamPanel(true)} />
      </div>

      {/* ON SITE NOW */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 13, letterSpacing: 2, color: T.green, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.green, display: 'inline-block' }} />
          ON SITE NOW
        </div>
        <button onClick={() => setView('jobs')} style={{ background: 'transparent', border: 'none', color: T.textDim, fontSize: 13, cursor: 'pointer', letterSpacing: 1 }}>VIEW ALL →</button>
      </div>

      {onSiteJobs.length === 0 && (
        <div style={{ background: T.panel, padding: 20, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
          Nobody clocked in yet today.
        </div>
      )}
      {onSiteJobs.map(j => (
        <JobRow key={j.id} job={j} role={role} onClick={() => gotoJob(j.id)} timelog={timelog} today={todayStr} />
      ))}

      {/* PAUSED */}
      {pausedJobs.length > 0 && (
        <>
          <div style={{ fontSize: 13, letterSpacing: 2, color: T.accent, fontWeight: 700, marginTop: 24, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.accent, display: 'inline-block' }} />
            PAUSED · STARTED, NO BODIES TODAY
          </div>
          {pausedJobs.map(j => (
            <JobRow key={j.id} job={j} role={role} onClick={() => gotoJob(j.id)} timelog={timelog} today={todayStr} />
          ))}
        </>
      )}

      <div style={{ fontSize: 13, letterSpacing: 2, color: T.textDim, fontWeight: 700, marginTop: 24, marginBottom: 10 }}>STARTING SOON</div>
      {jobs.filter(j => j.status === 'scheduled').slice(0, 3).map(j => (
        <JobRow key={j.id} job={j} role={role} onClick={() => gotoJob(j.id)} timelog={timelog} today={todayStr} />
      ))}

      {showTeamPanel && (
        <TeamOutPanel team={team} jobs={jobs} teamByJob={teamByJob} role={role} onClose={() => setShowTeamPanel(false)} gotoJob={(id) => { setShowTeamPanel(false); gotoJob(id); }} />
      )}
    </div>
  );
}

// Slide-out panel showing who's clocked in where right now
function TeamOutPanel({ team, jobs, teamByJob, role, onClose, gotoJob }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, width: '100%', maxWidth: 480, height: '100vh', overflowY: 'auto', borderLeft: `2px solid ${T.accent}` }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>RIGHT NOW</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>WHO'S WORKING WHERE</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {Object.keys(teamByJob).length === 0 && (
            <div style={{ textAlign: 'center', padding: 30, color: T.textDim, fontSize: 15 }}>No one clocked in right now.</div>
          )}
          {Object.entries(teamByJob).map(([jobId, entries]) => {
            const job = jobs.find(j => j.id === jobId);
            if (!job) return null;
            const status = STATUS_STYLE[job.status];
            return (
              <div key={jobId} style={{ marginBottom: 18 }}>
                <div onClick={() => gotoJob(jobId)} style={{ background: T.panel2, padding: 12, borderLeft: `4px solid ${status.bg}`, cursor: 'pointer', marginBottom: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{job.name}</div>
                      <div style={{ fontSize: 13, color: T.textDim, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={11} /> {job.address}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: T.green, fontWeight: 700 }}>● {entries.length}</div>
                  </div>
                </div>
                {entries.map((e, i) => {
                  const member = team.find(m => m.name === e.worker);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: T.bg, marginBottom: 3 }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: member?.color || T.textMute, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                        {member?.initials || e.worker.split(' ').map(p => p[0]).join('')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>{e.worker}</div>
                        <div style={{ fontSize: 12, color: T.textDim }}>{member?.role || e.role}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 13, color: T.green, fontWeight: 700 }}>● ON CLOCK</div>
                        <div style={{ fontSize: 12, color: T.textDim }}>since {e.clockIn}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SHARED — JOB ROW
// ============================================================
function JobRow({ job, role, onClick, timelog, today }) {
  const displayStatus = timelog ? getJobDisplayStatus(job, timelog, today || '2026-04-29') : job.status;
  const status = STATUS_STYLE[displayStatus] || STATUS_STYLE[job.status];
  const mat = MAT_STYLE[job.materialStatus];
  const MatIcon = mat.icon;
  return (
    <div
      onClick={onClick}
      style={{
        background: T.panel, padding: '14px 16px', marginBottom: 8,
        borderLeft: `4px solid ${status.bg}`, cursor: 'pointer',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = T.panel2}
      onMouseLeave={e => e.currentTarget.style.background = T.panel}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{job.name}</div>
          <div style={{ fontSize: 13, color: T.textDim, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} /> {job.address}
            {job.daysElapsed > 0 && <span style={{ marginLeft: 8 }}>· Day {job.daysElapsed} of {job.projectedDays}</span>}
            {job.daysElapsed === 0 && job.startDate && <span style={{ marginLeft: 8 }}>· Starts {parseDate(job.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
            {!job.startDate && <span style={{ marginLeft: 8, color: T.purple }}>· Needs scheduling</span>}
          </div>
        </div>
        <div style={{ background: status.bg, color: status.fg, padding: '3px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
          {status.label}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
        <span style={{ color: T.textDim }}>TEAM <span style={{ color: T.text, fontWeight: 600 }}>{job.foreman}{job.crew.length > 1 ? ` +${job.crew.length - 1}` : ''}</span></span>
        <span style={{ color: T.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>
          MATERIALS <span style={{ color: mat.color, display: 'flex', alignItems: 'center', gap: 3 }}>
            <MatIcon size={11} /> {mat.label}
          </span>
        </span>
        {role.canSeeBurn && job.contractValue && (() => {
          const projP = job.contractValue - (job.laborBudget || 0) - (job.materialBudget || 0);
          const projPct = job.contractValue > 0 ? (projP / job.contractValue) * 100 : 0;
          const tier = marginTier(projPct);
          return (
            <span style={{ color: T.textDim }}>
              PROJ. PROFIT <span style={{ color: tier.color, fontWeight: 600 }}>
                {fmtMoney(projP)} ({Math.round(projPct)}%)
              </span>
            </span>
          );
        })()}
      </div>
    </div>
  );
}

// ============================================================
// VIEW — JOBS LIST + DETAIL
// ============================================================
// ============================================================
// NEW JOB MODAL — form to create a new job with start/end dates
// ============================================================
function NewJobModal({ team, onClose, onSave }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState('Roofing');
  const [contractValue, setContractValue] = useState('');
  const [laborBudget, setLaborBudget] = useState('');
  const [materialBudget, setMaterialBudget] = useState('');
  const [foreman, setForeman] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [materialsExpectedDate, setMaterialsExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  // Auto-calculate projected days from start + end
  const projectedDays = (startDate && endDate)
    ? Math.max(1, Math.round((parseDate(endDate) - parseDate(startDate)) / (1000 * 60 * 60 * 24)) + 1)
    : 0;

  const datesValid = startDate && endDate && parseDate(endDate) >= parseDate(startDate);
  const requiredOk = name && address && contractValue && datesValid;

  // Default labor + material budgets to a sensible 25% / 50% split if user hasn't typed them
  const handleSave = () => {
    const cv = parseFloat(contractValue) || 0;
    const lb = parseFloat(laborBudget) || Math.round(cv * 0.25);
    const mb = parseFloat(materialBudget) || Math.round(cv * 0.45);

    onSave({
      name,
      address,
      type,
      status: 'scheduled',
      startDate,
      endDate,
      projectedDays,
      contractValue: cv,
      laborBudget: lb,
      materialBudget: mb,
      foreman: foreman || null,
      crew: foreman ? [foreman] : [],
      materialsExpectedDate: materialsExpectedDate || null,
      materialStatus: materialsExpectedDate ? 'ordered' : 'pending',
      notes: notes || '',
      lat: null, lng: null, geofenceMiles: 1,
      dailyBurn: 0,
      draws: [],
    });
  };

  // Quick-pick day shortcuts: tomorrow, next Mon, next Mon+1
  const quickPicks = (() => {
    const today = parseDate('2026-04-29');
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    const mon = new Date(today);
    const dow = mon.getDay();
    const daysUntilMon = dow === 0 ? 1 : (8 - dow); // next Monday
    mon.setDate(mon.getDate() + daysUntilMon);
    const monNext = new Date(mon); monNext.setDate(mon.getDate() + 7);
    return [
      { label: 'Tomorrow', date: isoDate(tom) },
      { label: 'Next Mon', date: isoDate(mon) },
      { label: 'Following Mon', date: isoDate(monNext) },
    ];
  })();

  // When user changes start, auto-suggest end +2 days for roofing, +6 for construction
  const handleStartChange = (newStart) => {
    setStartDate(newStart);
    if (!endDate) {
      const start = parseDate(newStart);
      const days = type === 'Construction' ? 6 : 2;
      const end = new Date(start); end.setDate(start.getDate() + days);
      setEndDate(isoDate(end));
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 540, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>NEW JOB</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* JOB NAME */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>JOB NAME *</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Martinez Residence — Reroof" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
          </div>

          {/* ADDRESS */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>ADDRESS *</div>
            <input value={address} onChange={e => setAddress(e.target.value)} placeholder="e.g. 4521 E Camelback Rd, Phoenix" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
          </div>

          {/* TYPE + FOREMAN */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>TYPE</div>
              <select value={type} onChange={e => setType(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }}>
                <option value="Roofing">Roofing</option>
                <option value="Construction">Construction</option>
                <option value="Drafting">Drafting</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>FOREMAN</div>
              <select value={foreman} onChange={e => setForeman(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }}>
                <option value="">— Select —</option>
                {team.filter(m => m.role.includes('Foreman')).map(m => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* SCHEDULE */}
          <div style={{ background: T.panel2, padding: 12, marginBottom: 12, borderLeft: `3px solid ${T.accent}` }}>
            <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Calendar size={11} /> SCHEDULE *
            </div>

            {/* Quick picks for start */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {quickPicks.map(qp => (
                <button key={qp.label} onClick={() => handleStartChange(qp.date)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.textDim, padding: '4px 10px', fontSize: 12, letterSpacing: 1, fontWeight: 700, cursor: 'pointer' }}>
                  {qp.label.toUpperCase()}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>START DATE</div>
                <input type="date" value={startDate} onChange={e => handleStartChange(e.target.value)} style={{ width: '100%', background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>END DATE</div>
                <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} style={{ width: '100%', background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
              </div>
            </div>

            {projectedDays > 0 && datesValid && (
              <div style={{ fontSize: 13, color: T.green, marginTop: 8, fontWeight: 700 }}>
                ✓ {projectedDays} {projectedDays === 1 ? 'day' : 'days'} · {parseDate(startDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} → {parseDate(endDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            )}
            {startDate && endDate && !datesValid && (
              <div style={{ fontSize: 13, color: T.red, marginTop: 8 }}>⚠ End date must be on or after start date</div>
            )}
          </div>

          {/* MATERIALS DROP */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Truck size={10} /> MATERIALS DROP DATE (optional)
            </div>
            <input type="date" value={materialsExpectedDate} onChange={e => setMaterialsExpectedDate(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
          </div>

          {/* MONEY */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>CONTRACT VALUE *</div>
            <input type="number" step="100" value={contractValue} onChange={e => setContractValue(e.target.value)} placeholder="18500" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.accent, padding: '10px 12px', fontSize: 18, fontFamily: 'inherit', fontWeight: 700 }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>LABOR BUDGET</div>
              <input type="number" step="100" value={laborBudget} onChange={e => setLaborBudget(e.target.value)} placeholder={contractValue ? `~${Math.round(contractValue * 0.25)}` : 'auto'} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>MATERIAL BUDGET</div>
              <input type="number" step="100" value={materialBudget} onChange={e => setMaterialBudget(e.target.value)} placeholder={contractValue ? `~${Math.round(contractValue * 0.45)}` : 'auto'} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
          </div>

          {/* LIVE PROJECTED PROFIT PREVIEW */}
          {contractValue && (() => {
            const cv = parseFloat(contractValue) || 0;
            const lb = parseFloat(laborBudget) || (cv * 0.25);
            const mb = parseFloat(materialBudget) || (cv * 0.45);
            const projP = cv - lb - mb;
            const projPct = cv > 0 ? (projP / cv) * 100 : 0;
            const tier = marginTier(projPct);
            return (
              <div style={{ background: T.bg, padding: 12, marginBottom: 14, borderLeft: `3px solid ${tier.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrendingUp size={11} style={{ color: tier.color }} /> PROJECTED PROFIT
                    <span style={{ background: tier.color, color: '#000', padding: '1px 6px', fontSize: 12, letterSpacing: 1, fontWeight: 800 }}>
                      {tier.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: tier.color }}>
                    {fmtMoney(projP)} <span style={{ fontSize: 13, color: T.textDim }}>({projPct.toFixed(1)}%)</span>
                  </div>
                </div>
                {tier.warning && <div style={{ fontSize: 12, color: tier.color, marginTop: 4 }}>⚠ {tier.warning}</div>}
              </div>
            );
          })()}

          {/* NOTES */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NOTES</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Customer prefers early start. Dogs in backyard. Etc." rows={2} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>

          <button
            onClick={handleSave}
            disabled={!requiredOk}
            style={{
              width: '100%',
              background: requiredOk ? T.accent : T.panel2,
              color: requiredOk ? '#000' : T.textMute,
              border: 'none', padding: '14px',
              fontWeight: 800, fontSize: 15, letterSpacing: 1,
              cursor: requiredOk ? 'pointer' : 'not-allowed',
            }}
          >
            ✓ CREATE JOB
          </button>

          {!requiredOk && (
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 8, textAlign: 'center' }}>
              Fill in name, address, contract value, and valid dates to continue.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobsView({ jobs, role, focusedJobId, setFocusedJobId, expenses, timelog, team, onAddJob }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('startDate');
  const [showNewJobModal, setShowNewJobModal] = useState(false);
  const job = jobs.find(j => j.id === focusedJobId);
  const todayStr = '2026-04-29';

  if (job) return <JobDetail job={job} role={role} onBack={() => setFocusedJobId(null)} expenses={expenses} timelog={timelog} team={team} />;

  let filtered = jobs.filter(j => {
    if (filter !== 'all') {
      const display = getJobDisplayStatus(j, timelog, todayStr);
      if (display !== filter) return false;
    } else {
      // ALL filter excludes complete jobs (they live on Financials tab)
      if (j.status === 'complete') return false;
    }
    if (search && !j.name.toLowerCase().includes(search.toLowerCase()) && !j.address.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Sort
  const today = parseDate(todayStr);
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'startDate') {
      // Active first (today is in range), then upcoming by start asc, then no-date jobs last
      const aActive = a.startDate && a.endDate && parseDate(a.startDate) <= today && parseDate(a.endDate) >= today;
      const bActive = b.startDate && b.endDate && parseDate(b.startDate) <= today && parseDate(b.endDate) >= today;
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      if (!a.startDate && b.startDate) return 1;
      if (a.startDate && !b.startDate) return -1;
      if (!a.startDate && !b.startDate) return 0;
      return a.startDate.localeCompare(b.startDate);
    }
    if (sortBy === 'contract') return (b.contractValue || 0) - (a.contractValue || 0);
    if (sortBy === 'margin') {
      const aM = a.contractValue ? (a.contractValue - (a.laborBudget || 0) - (a.materialBudget || 0)) / a.contractValue : 0;
      const bM = b.contractValue ? (b.contractValue - (b.laborBudget || 0) - (b.materialBudget || 0)) / b.contractValue : 0;
      return bM - aM;
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'newest') return b.id.localeCompare(a.id);
    return 0;
  });

  const filters = [
    { id: 'all', label: 'ALL' },
    { id: 'on-site', label: 'ON SITE' },
    { id: 'paused', label: 'PAUSED' },
    { id: 'scheduled', label: 'SCHEDULED' },
    { id: 'pending-schedule', label: 'NEEDS SCHEDULING' },
    { id: 'complete', label: 'COMPLETE' },
  ];

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>All Jobs</div>
        {role.canEdit && (
          <button onClick={() => setShowNewJobModal(true)} style={{ background: T.accent, color: '#000', border: 'none', padding: '8px 14px', fontWeight: 700, fontSize: 13, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> NEW JOB
          </button>
        )}
      </div>

      {showNewJobModal && <NewJobModal team={team} onClose={() => setShowNewJobModal(false)} onSave={(data) => { onAddJob(data); setShowNewJobModal(false); }} />}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 180 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: 10, color: T.textDim }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search jobs or addresses..."
            style={{ width: '100%', background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 8px 8px 30px', fontSize: 14, fontFamily: 'inherit' }}
          />
        </div>
        {filters.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              background: filter === f.id ? T.accent : T.panel,
              color: filter === f.id ? '#000' : T.textDim,
              border: `1px solid ${filter === f.id ? T.accent : T.border}`,
              padding: '8px 12px', fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: 'pointer',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* SORT dropdown */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11, letterSpacing: 1, color: T.textDim, fontWeight: 700 }}>SORT BY:</div>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '6px 8px', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          <option value="startDate">Start date (next-up first)</option>
          <option value="contract">Contract value (high → low)</option>
          <option value="margin">Margin (best → worst)</option>
          <option value="name">Alphabetical</option>
          <option value="newest">Newest first</option>
        </select>
        <div style={{ fontSize: 11, color: T.textDim, marginLeft: 'auto' }}>{filtered.length} {filtered.length === 1 ? 'job' : 'jobs'}</div>
      </div>

      {filtered.map(j => (
        <JobRow key={j.id} job={j} role={role} onClick={() => setFocusedJobId(j.id)} timelog={timelog} today="2026-04-29" />
      ))}
      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: T.textDim, fontSize: 14 }}>No jobs match your filters.</div>
      )}
    </div>
  );
}

function JobDetail({ job, role, onBack, expenses, timelog, team }) {
  const todayStr = '2026-04-29';
  const displayStatus = getJobDisplayStatus(job, timelog, todayStr);
  const status = STATUS_STYLE[displayStatus] || STATUS_STYLE[job.status];

  // Calculate REAL labor spent on this job from time log
  // For daily/salary workers, prorate by hours-on-job ÷ total-hours-that-day so we don't double-count
  // when someone hits multiple jobs in one day
  const jobTimeEntries = (timelog || []).filter(t => t.jobId === job.id);
  const laborSpent = jobTimeEntries.reduce((sum, entry) => {
    const member = (team || []).find(m => m.name === entry.worker);
    if (!member) return sum;
    const allThatDay = (timelog || []).filter(t => t.worker === entry.worker && t.date === entry.date);
    return sum + entryCostOnJob(member, entry, allThatDay);
  }, 0);

  // Calculate REAL material spent from expenses allocated to this job
  const materialSpent = (expenses || []).reduce((sum, exp) => {
    const alloc = exp.allocations.find(a => a.jobId === job.id);
    return sum + (alloc?.amount || 0);
  }, 0);

  const totalSpent = laborSpent + materialSpent;
  const liveMargin = job.contractValue - totalSpent;
  const liveMarginPct = job.contractValue > 0 ? ((liveMargin / job.contractValue) * 100).toFixed(1) : '0.0';

  // PROJECTED PROFIT — what you expect to make based on budgets set at contract signing.
  // This stays stable as actual costs flow in, so you can compare projected vs live.
  const projectedProfit = job.contractValue - (job.laborBudget || 0) - (job.materialBudget || 0);
  const projectedMarginPct = job.contractValue > 0 ? ((projectedProfit / job.contractValue) * 100).toFixed(1) : '0.0';

  // Variance: how the live profit compares to what you projected
  const profitVariance = liveMargin - projectedProfit;

  const laborPct = job.laborBudget ? Math.min(100, (laborSpent / job.laborBudget) * 100) : 0;
  const materialPct = job.materialBudget ? Math.min(100, (materialSpent / job.materialBudget) * 100) : 0;
  const laborOver = laborSpent > job.laborBudget;
  const materialOver = materialSpent > job.materialBudget;

  return (
    <div style={{ padding: 20 }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: T.textDim, fontSize: 13, cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 1 }}>
        <ChevronLeft size={14} /> ALL JOBS
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>{job.name}</div>
          <div style={{ fontSize: 14, color: T.textDim, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={12} /> {job.address}
          </div>
        </div>
        <div style={{ background: status.bg, color: status.fg, padding: '5px 12px', fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
          {status.label}
        </div>
      </div>

      {/* PAUSE INFO — only shows when paused */}
      {displayStatus === 'paused' && (
        <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${T.accent}` }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={11} /> CURRENTLY PAUSED
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: job.pauseReason ? 12 : 0 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>EXPECTED RESUME</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.accent }}>
                {job.expectedResume
                  ? parseDate(job.expectedResume).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                  : <span style={{ color: T.textMute, fontSize: 15 }}>Not set</span>}
              </div>
              {job.expectedResume && (() => {
                const today = parseDate(todayStr);
                const resume = parseDate(job.expectedResume);
                const days = Math.round((resume - today) / (1000 * 60 * 60 * 24));
                if (days === 0) return <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>resumes today</div>;
                if (days === 1) return <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>resumes tomorrow</div>;
                if (days > 1) return <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>in {days} days</div>;
                return <div style={{ fontSize: 12, color: T.red, marginTop: 2 }}>{Math.abs(days)} days overdue</div>;
              })()}
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>DAYS PAUSED</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>
                {(() => {
                  // Days since the last clock-in entry on this job
                  const lastEntry = (timelog || [])
                    .filter(t => t.jobId === job.id)
                    .sort((a, b) => b.date.localeCompare(a.date))[0];
                  if (!lastEntry) return '—';
                  const last = parseDate(lastEntry.date);
                  const today = parseDate(todayStr);
                  const days = Math.round((today - last) / (1000 * 60 * 60 * 24));
                  return days === 0 ? '<1' : days;
                })()}
              </div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>since last clock-in</div>
            </div>
          </div>
          {job.pauseReason && (
            <div style={{ background: T.bg, padding: 10, borderLeft: `2px solid ${T.textMute}`, fontSize: 14, color: T.text, fontStyle: 'italic' }}>
              "{job.pauseReason}"
            </div>
          )}
        </div>
      )}

      {/* TIMELINE / PROGRESS */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 12 }}>TIMELINE</div>

        {/* MILESTONE DATES */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 2 }}>STARTED</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: job.startDate ? T.text : T.textMute }}>
              {job.startDate
                ? parseDate(job.startDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : 'Not scheduled'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 2 }}>EST. COMPLETION</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: job.endDate ? T.text : T.textMute }}>
              {job.endDate
                ? parseDate(job.endDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : 'Not scheduled'}
            </div>
            {job.endDate && (() => {
              const today = parseDate(todayStr);
              const end = parseDate(job.endDate);
              const days = Math.round((end - today) / (1000 * 60 * 60 * 24));
              if (days === 0) return <div style={{ fontSize: 12, color: T.accent, marginTop: 2 }}>due today</div>;
              if (days > 0) return <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{days} {days === 1 ? 'day' : 'days'} left</div>;
              return <div style={{ fontSize: 12, color: T.red, marginTop: 2 }}>{Math.abs(days)} {Math.abs(days) === 1 ? 'day' : 'days'} overdue</div>;
            })()}
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 2 }}>DAYS WORKED</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{job.daysElapsed} of {job.projectedDays}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{Math.max(0, job.projectedDays - job.daysElapsed)} remaining</div>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div style={{ height: 8, background: T.bg, position: 'relative', overflow: 'hidden', marginBottom: 4 }}>
          <div style={{ height: '100%', width: `${Math.min(100, (job.daysElapsed / job.projectedDays) * 100)}%`, background: displayStatus === 'paused' ? T.accent : T.green }} />
        </div>
        <div style={{ fontSize: 12, color: T.textDim, textAlign: 'right' }}>{Math.round((job.daysElapsed / job.projectedDays) * 100)}% complete</div>
      </div>

      {/* FINANCIALS — ROLE GATED */}
      {role.canSeeBurn && (
        <>
          <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${T.accent}` }}>
            <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <DollarSign size={11} /> FINANCIALS — INTERNAL
            </div>

            {/* PROJECTED PROFIT — the headline number */}
            {(() => {
              const tier = marginTier(parseFloat(projectedMarginPct));
              return (
                <div style={{ background: T.bg, padding: 14, marginBottom: 14, borderLeft: `3px solid ${tier.color}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <TrendingUp size={11} style={{ color: tier.color }} /> PROJECTED PROFIT
                        <span style={{ background: tier.color, color: '#000', padding: '1px 6px', fontSize: 12, letterSpacing: 1, fontWeight: 800 }}>
                          {tier.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>
                        {fmtMoney(job.contractValue)} − {fmtMoney(job.laborBudget || 0)} labor − {fmtMoney(job.materialBudget || 0)} mat
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 30, fontWeight: 800, color: tier.color, lineHeight: 1 }}>
                        {fmtMoney(projectedProfit)}
                      </div>
                      <div style={{ fontSize: 13, color: T.textDim, letterSpacing: 1, marginTop: 4 }}>
                        {projectedMarginPct}% MARGIN
                      </div>
                    </div>
                  </div>
                  {tier.warning && <div style={{ fontSize: 12, color: tier.color, marginTop: 8 }}>⚠ {tier.warning}</div>}
                </div>
              );
            })()}

            {/* CONTRACT + ACTUAL COSTS GRID */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>CONTRACT</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtMoney(job.contractValue)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>LABOR BURN</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.accent }}>{fmtMoney(laborSpent)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>MATERIAL BURN</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: T.blue }}>{fmtMoney(materialSpent)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>LIVE PROFIT</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: liveMargin > 0 ? T.green : T.red }}>
                  {fmtMoney(liveMargin)} <span style={{ fontSize: 13, color: T.textDim }}>({liveMarginPct}%)</span>
                </div>
                {totalSpent > 0 && Math.abs(profitVariance) > 50 && (
                  <div style={{ fontSize: 12, color: profitVariance > 0 ? T.green : T.red, marginTop: 2 }}>
                    {profitVariance > 0 ? '↑' : '↓'} {fmtMoney(Math.abs(profitVariance))} vs projected
                  </div>
                )}
              </div>
            </div>

            {/* LABOR BUDGET */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: T.textDim, letterSpacing: 1, fontWeight: 600 }}>LABOR BUDGET</span>
                <span style={{ color: laborOver ? T.red : T.text, fontWeight: 700 }}>
                  {fmtMoney(laborSpent)} / {fmtMoney(job.laborBudget)}
                  {laborOver && <span style={{ color: T.red, marginLeft: 6 }}>⚠ OVER</span>}
                </span>
              </div>
              <div style={{ height: 6, background: T.bg, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${laborPct}%`, background: laborOver ? T.red : laborPct > 80 ? T.accent : T.green }} />
              </div>
            </div>

            {/* MATERIAL BUDGET */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: T.textDim, letterSpacing: 1, fontWeight: 600 }}>MATERIAL BUDGET</span>
                <span style={{ color: materialOver ? T.red : T.text, fontWeight: 700 }}>
                  {fmtMoney(materialSpent)} / {fmtMoney(job.materialBudget)}
                  {materialOver && <span style={{ color: T.red, marginLeft: 6 }}>⚠ OVER</span>}
                </span>
              </div>
              <div style={{ height: 6, background: T.bg, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${materialPct}%`, background: materialOver ? T.red : materialPct > 80 ? T.accent : T.green }} />
              </div>
            </div>
          </div>

          {/* DRAW SCHEDULE — payment milestones */}
          {job.draws && job.draws.length > 0 && (() => {
            const totalReceived = job.draws.filter(d => d.status === 'received').reduce((s, d) => s + d.amount, 0);
            const totalRequested = job.draws.filter(d => d.status === 'requested').reduce((s, d) => s + d.amount, 0);
            const totalPending = job.draws.filter(d => d.status === 'pending').reduce((s, d) => s + d.amount, 0);
            const pctReceived = (totalReceived / job.contractValue) * 100;

            return (
              <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${T.green}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: 12, letterSpacing: 2, color: T.green, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Wallet size={11} /> DRAW SCHEDULE
                  </div>
                  <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>{job.draws.length} MILESTONES</div>
                </div>

                {/* TOTALS */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>RECEIVED</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.green }}>{fmtMoney(totalReceived)}</div>
                    <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{Math.round(pctReceived)}% of contract</div>
                  </div>
                  {totalRequested > 0 && (
                    <div>
                      <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>REQUESTED</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: T.accent }}>{fmtMoney(totalRequested)}</div>
                      <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>awaiting payment</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>OUTSTANDING</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{fmtMoney(totalPending + totalRequested)}</div>
                    <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>not yet received</div>
                  </div>
                </div>

                {/* PROGRESS BAR */}
                <div style={{ height: 8, background: T.bg, overflow: 'hidden', position: 'relative', marginBottom: 4 }}>
                  <div style={{ height: '100%', width: `${pctReceived}%`, background: T.green, position: 'absolute', left: 0 }} />
                  {totalRequested > 0 && (
                    <div style={{ height: '100%', width: `${(totalRequested / job.contractValue) * 100}%`, background: T.accent, position: 'absolute', left: `${pctReceived}%` }} />
                  )}
                </div>
                <div style={{ fontSize: 12, color: T.textDim, textAlign: 'right', marginBottom: 14 }}>
                  Contract total: <span style={{ color: T.text, fontWeight: 700 }}>{fmtMoney(job.contractValue)}</span>
                </div>

                {/* INDIVIDUAL DRAWS */}
                {job.draws.map((d, i) => {
                  const statusConfig = {
                    received:  { color: T.green,  bg: '#0a2818', label: '✓ RECEIVED', icon: CheckCircle2 },
                    requested: { color: T.accent, bg: '#1a1410', label: '◔ REQUESTED', icon: Clock },
                    pending:   { color: T.textMute, bg: T.bg,    label: '○ PENDING',   icon: Clock },
                  };
                  const cfg = statusConfig[d.status];
                  const StatusIcon = cfg.icon;
                  return (
                    <div key={d.id} style={{ background: cfg.bg, padding: 12, marginBottom: 6, borderLeft: `3px solid ${cfg.color}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <div style={{ fontSize: 15, fontWeight: 700 }}>
                              {i + 1}. {d.name}
                            </div>
                            <div style={{ fontSize: 12, color: cfg.color, letterSpacing: 1, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 3 }}>
                              <StatusIcon size={10} /> {cfg.label}
                            </div>
                          </div>
                          <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.5 }}>{d.description}</div>
                          {d.date && (
                            <div style={{ fontSize: 12, color: cfg.color, marginTop: 4 }}>
                              {d.status === 'received' ? 'Received' : 'Requested'} {parseDate(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                              {d.method && <span style={{ color: T.textDim }}> · {d.method}</span>}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{fmtMoney(d.amount)}</div>
                          <div style={{ fontSize: 12, color: T.textDim }}>{d.pct}% of contract</div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* VERIFY DRAWS BALANCE THE CONTRACT */}
                {(() => {
                  const drawSum = job.draws.reduce((s, d) => s + d.amount, 0);
                  if (Math.abs(drawSum - job.contractValue) > 1) {
                    return (
                      <div style={{ background: '#2d0e0e', padding: 8, marginTop: 8, fontSize: 12, color: T.red, borderLeft: `2px solid ${T.red}` }}>
                        ⚠ Draws total {fmtMoney(drawSum)} but contract is {fmtMoney(job.contractValue)}. Off by {fmtMoney(Math.abs(drawSum - job.contractValue))}.
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })()}
        </>
      )}

      {/* TEAM ASSIGNED */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Users size={11} /> TEAM ASSIGNED
        </div>
        {job.crew.map((c, i) => {
          const member = (team || SEED_TEAM).find(t => t.name === c);
          const isForeman = c === job.foreman;
          const memberHours = jobTimeEntries.filter(t => t.worker === c).reduce((s, t) => s + t.hours, 0);
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < job.crew.length - 1 ? `1px solid ${T.border}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: member?.color || T.textMute, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
                  {member?.initials || c.split(' ').map(p => p[0]).join('')}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{c}{isForeman && <span style={{ color: T.accent, fontSize: 12, marginLeft: 6, letterSpacing: 1 }}>FOREMAN</span>}</div>
                  <div style={{ fontSize: 13, color: T.textDim }}>{member?.role || 'Field Worker'}{memberHours > 0 && ` · ${memberHours}h logged`}</div>
                </div>
              </div>
              {role.canSeePay && member && (
                <div style={{ fontSize: 13, color: T.green, fontWeight: 600 }}>{fmtPayRate(member)}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* WORK HISTORY — every day worked, who was there, how long */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={11} /> WORK HISTORY
        </div>
        {jobTimeEntries.length === 0 ? (
          <div style={{ padding: 14, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
            No work logged on this job yet.
          </div>
        ) : (() => {
          // Group entries by date, sorted newest first
          const byDate = {};
          jobTimeEntries.forEach(e => {
            if (!byDate[e.date]) byDate[e.date] = [];
            byDate[e.date].push(e);
          });
          const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

          return sortedDates.map((date, di) => {
            const dayEntries = byDate[date];
            const dayHours = dayEntries.reduce((s, e) => s + e.hours, 0);
            const dateObj = parseDate(date);
            const isToday = date === todayStr;
            const uniquePeople = new Set(dayEntries.map(e => e.worker)).size;

            return (
              <div key={date} style={{ marginBottom: di < sortedDates.length - 1 ? 14 : 0 }}>
                {/* Day header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.border}`, marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    {isToday && <span style={{ fontSize: 12, background: T.green, color: '#000', padding: '1px 6px', letterSpacing: 1, fontWeight: 800 }}>TODAY</span>}
                  </div>
                  <div style={{ fontSize: 13, color: T.textDim }}>
                    <span style={{ color: T.text, fontWeight: 600 }}>{uniquePeople}</span> {uniquePeople === 1 ? 'person' : 'people'}
                    <span style={{ marginLeft: 8, color: T.accent, fontWeight: 700 }}>{dayHours}h total</span>
                  </div>
                </div>

                {/* Entries for this day */}
                {dayEntries.map((e, i) => {
                  const member = (team || SEED_TEAM).find(t => t.name === e.worker);
                  const isOpen = !e.clockOut;
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: member?.color || T.textMute, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                        {member?.initials || e.worker.split(' ').map(p => p[0]).join('')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {e.worker}
                          {isOpen && <span style={{ color: T.green, fontSize: 12 }}>● ON CLOCK</span>}
                          {!e.verified && <span title={e.flagReason} style={{ color: T.red, display: 'flex' }}><ShieldAlert size={11} /></span>}
                          {e.adminEntry && <span title={`Logged by ${e.clockedInBy}`} style={{ color: T.accent, display: 'flex' }}><User size={11} /></span>}
                        </div>
                        <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>
                          {e.clockIn || '—'}{e.clockOut && ` – ${e.clockOut}`}{isOpen && ' · still on clock'}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, color: T.accent, fontWeight: 700, flexShrink: 0 }}>{e.hours}h</div>
                    </div>
                  );
                })}
              </div>
            );
          });
        })()}
      </div>

      {/* MATERIALS */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Package size={11} /> MATERIALS
        </div>
        {job.materials.map((m, i) => {
          const ms = MAT_STYLE[m.status] || MAT_STYLE.pending;
          const Icon = ms.icon;
          return (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < job.materials.length - 1 ? `1px solid ${T.border}` : 'none' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                <div style={{ fontSize: 13, color: T.textDim, marginTop: 2 }}>{m.qty} · {m.date}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: ms.color, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
                <Icon size={12} /> {ms.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* NOTES */}
      <div style={{ background: T.panel, padding: 16 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10 }}>SITE NOTES</div>
        <div style={{ fontSize: 15, color: T.text, lineHeight: 1.6 }}>{job.notes}</div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — MONTHLY CALENDAR
// ============================================================
function CalendarView({ jobs, gotoJob }) {
  const [cursor, setCursor] = useState(new Date(2026, 3, 1)); // April 2026
  const monthName = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const startWeekday = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));

  const today = parseDate('2026-04-29');

  const jobsForDay = (date) => jobs.filter(j => {
    if (!j.startDate || !j.endDate) return false;
    return inRange(date, parseDate(j.startDate), parseDate(j.endDate));
  });

  const pendingJobs = jobs.filter(j => j.status === 'pending-schedule');

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Monthly Calendar</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '6px 8px', cursor: 'pointer' }}><ChevronLeft size={14} /></button>
          <div style={{ fontSize: 16, fontWeight: 700, padding: '0 12px', minWidth: 140, textAlign: 'center', letterSpacing: 1 }}>{monthName.toUpperCase()}</div>
          <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '6px 8px', cursor: 'pointer' }}><ChevronRight size={14} /></button>
        </div>
      </div>

      {pendingJobs.length > 0 && (
        <div style={{ background: T.panel, borderLeft: `3px solid ${T.purple}`, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.purple, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={11} /> NEEDS SCHEDULING · {pendingJobs.length}
          </div>
          <div style={{ fontSize: 13, color: T.textDim }}>
            {pendingJobs.map(j => j.name.split(' — ')[0]).join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: T.textMute, marginTop: 6, letterSpacing: 1 }}>
            GO TO JOBS → SET START + END DATES TO SCHEDULE
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: T.border, border: `1px solid ${T.border}` }}>
        {['SUN','MON','TUE','WED','THU','FRI','SAT'].map(d => (
          <div key={d} style={{ background: T.panel, padding: 8, fontSize: 12, color: T.textDim, fontWeight: 700, letterSpacing: 1, textAlign: 'center' }}>{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} style={{ background: T.bg, minHeight: 80 }} />;
          const dayJobs = jobsForDay(date);
          const isToday = sameDay(date, today);
          return (
            <div key={i} style={{ background: T.panel, minHeight: 80, padding: 6, position: 'relative', borderTop: isToday ? `2px solid ${T.accent}` : 'none' }}>
              <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 600, color: isToday ? T.accent : T.text, marginBottom: 4 }}>{date.getDate()}</div>
              {dayJobs.slice(0, 3).map(j => {
                const status = STATUS_STYLE[j.status];
                return (
                  <div
                    key={j.id}
                    onClick={() => gotoJob(j.id)}
                    style={{
                      background: status.bg, color: status.fg, padding: '2px 5px', fontSize: 12, marginBottom: 2,
                      cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700,
                    }}
                    title={j.name}
                  >
                    {j.name.split(' — ')[0]}
                  </div>
                );
              })}
              {dayJobs.length > 3 && <div style={{ fontSize: 12, color: T.textDim }}>+{dayJobs.length - 3} more</div>}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap', fontSize: 12, color: T.textDim, letterSpacing: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: T.green, display: 'inline-block' }} /> ACTIVE</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: T.accent, display: 'inline-block' }} /> PAUSED</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, background: '#404040', display: 'inline-block' }} /> SCHEDULED</span>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — 2-WEEK LOOK AHEAD (GANTT)
// ============================================================
function LookAheadView({ jobs, gotoJob }) {
  const today = parseDate('2026-04-29');
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(today.getDate() + i); days.push(d);
  }
  const start = days[0], end = days[13];

  const visibleJobs = jobs.filter(j => {
    if (!j.startDate || !j.endDate) return false;
    const s = parseDate(j.startDate), e = parseDate(j.endDate);
    return s <= end && e >= start;
  });

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>2-Week Look Ahead</div>
        <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>
          {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — {end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      </div>

      <div style={{ background: T.panel, overflow: 'auto' }}>
        {/* Day header */}
        <div style={{ display: 'grid', gridTemplateColumns: '180px repeat(14, minmax(50px, 1fr))', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ padding: '10px 12px', fontSize: 12, color: T.textDim, fontWeight: 700, letterSpacing: 1, borderRight: `1px solid ${T.border}` }}>JOB</div>
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <div key={i} style={{
                padding: '8px 4px', textAlign: 'center', fontSize: 12,
                background: isToday ? T.accent : isWeekend ? T.bg : 'transparent',
                color: isToday ? '#000' : isWeekend ? T.textMute : T.text,
                fontWeight: isToday ? 800 : 600,
                borderRight: i < 13 ? `1px solid ${T.border}` : 'none',
              }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase()}</div>
                <div>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Job rows */}
        {visibleJobs.map(job => {
          const status = STATUS_STYLE[job.status];
          const jStart = parseDate(job.startDate), jEnd = parseDate(job.endDate);
          return (
            <div key={job.id} style={{ display: 'grid', gridTemplateColumns: '180px repeat(14, minmax(50px, 1fr))', borderBottom: `1px solid ${T.border}`, position: 'relative', minHeight: 50 }}>
              <div onClick={() => gotoJob(job.id)} style={{ padding: '10px 12px', borderRight: `1px solid ${T.border}`, cursor: 'pointer' }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{job.name.split(' — ')[0]}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{job.foreman}</div>
              </div>
              {days.map((d, i) => {
                const isInJob = inRange(d, jStart, jEnd);
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div
                    key={i}
                    onClick={() => isInJob && gotoJob(job.id)}
                    style={{
                      background: isInJob ? status.bg : isWeekend ? T.bg : 'transparent',
                      borderRight: i < 13 ? `1px solid ${T.border}` : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: isInJob ? status.fg : T.textMute, fontWeight: 700,
                      cursor: isInJob ? 'pointer' : 'default',
                    }}
                  >
                    {sameDay(d, jStart) && '▶'}
                    {sameDay(d, jEnd) && !sameDay(d, jStart) && '◀'}
                  </div>
                );
              })}
            </div>
          );
        })}

        {visibleJobs.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: T.textDim, fontSize: 14 }}>No jobs scheduled in this window.</div>
        )}
      </div>

      <div style={{ fontSize: 12, color: T.textDim, marginTop: 12, letterSpacing: 1 }}>
        TIP: TAP A JOB BAR FOR DETAILS · ▶ START · ◀ END
      </div>
    </div>
  );
}


// ============================================================
// VIEW — TEAM
// ============================================================
function TeamView({ team, jobs, role, timelog, onAddMember }) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Team</div>
        {role.canEdit && (
          <button onClick={() => setShowAdd(true)} style={{ background: T.accent, color: '#000', border: 'none', padding: '8px 14px', fontWeight: 700, fontSize: 13, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> ADD MEMBER
          </button>
        )}
      </div>

      {!role.canSeePay && (
        <div style={{ background: T.panel2, borderLeft: `3px solid ${T.textMute}`, padding: 10, marginBottom: 14, fontSize: 13, color: T.textDim, display: 'flex', alignItems: 'center', gap: 8 }}>
          <EyeOff size={12} /> Pay rates are hidden for your role.
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        {team.length === 0 && (
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, padding: 24, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
            No team members yet. Use <span style={{ color: T.accent, fontWeight: 700 }}>ADD MEMBER</span> to build the live roster.
          </div>
        )}
        {team.map(m => {
          const memberJobs = jobs.filter(j => j.crew.includes(m.name));
          const totalHours = timelog.filter(t => t.worker === m.name).reduce((s, t) => s + t.hours, 0);
          return (
            <div key={m.id} style={{ background: T.panel, padding: 14, borderLeft: `3px solid ${m.color}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: m.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                    {m.initials}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{m.name}</div>
                    <div style={{ fontSize: 13, color: T.textDim }}>{m.role}</div>
                  </div>
                </div>
                {role.canSeePay && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>{m.payType.toUpperCase()}</div>
                    <div style={{ fontSize: 15, color: T.green, fontWeight: 700 }}>{fmtPayRate(m)}</div>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, color: T.textDim, flexWrap: 'wrap' }}>
                <span>JOBS <span style={{ color: T.text, fontWeight: 600 }}>{memberJobs.length}</span></span>
                <span>HOURS WK <span style={{ color: T.text, fontWeight: 600 }}>{totalHours}h</span></span>
                {memberJobs.length > 0 && (
                  <span>CURRENT <span style={{ color: T.accent, fontWeight: 600 }}>{memberJobs[0].name.split(' — ')[0]}</span></span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <AddTeamMemberModal
          onClose={() => setShowAdd(false)}
          onAdd={(member) => {
            onAddMember(member);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}

function AddTeamMemberModal({ onClose, onAdd }) {
  const [name, setName] = useState('');
  const [tradeRole, setTradeRole] = useState('Roofer');
  const [payType, setPayType] = useState('hourly');
  const [payAmount, setPayAmount] = useState('');
  const [color, setColor] = useState(T.accent);
  const [error, setError] = useState('');

  const initialsFor = (value) => value
    .trim()
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'TM';

  const save = () => {
    const trimmedName = name.trim();
    const numericPay = Number(payAmount);
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }
    if (!Number.isFinite(numericPay) || numericPay < 0) {
      setError('Enter a valid pay amount.');
      return;
    }

    onAdd({
      id: 'tm' + Date.now(),
      name: trimmedName,
      role: tradeRole.trim() || 'Field Worker',
      payType,
      payAmount: numericPay,
      initials: initialsFor(trimmedName),
      color,
      active: true,
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 460, width: '100%' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>ADD TEAM MEMBER</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {error && (
            <div style={{ background: '#2d0e0e', borderLeft: `3px solid ${T.red}`, color: T.red, padding: 10, marginBottom: 12, fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NAME</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Worker name" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>ROLE / TRADE</div>
            <input value={tradeRole} onChange={e => setTradeRole(e.target.value)} placeholder="Roofer, Foreman, Carpenter..." style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>PAY TYPE</div>
              <select value={payType} onChange={e => setPayType(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="salary">Salary</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>PAY AMOUNT</div>
              <input type="number" min="0" step="0.01" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="0.00" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>COLOR</div>
            <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: 54, height: 34, background: T.panel2, border: `1px solid ${T.border}`, cursor: 'pointer' }} />
          </div>

          <button onClick={save} style={{ width: '100%', background: T.accent, color: '#000', border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer' }}>
            ADD MEMBER
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CLOCK IN MODAL — with geofence verification
// Supports: self mode (clock in/out self) + supervisor mode (foreman/owner clocks crew)
// ============================================================
function ClockInModal({ jobs, role, team, timelog, onClose, onClockIn, openEntry, onClockOut }) {
  const activeJobs = jobs.filter(j => j.status === 'active' || j.status === 'on-site' || j.status === 'in-progress');
  const isClockOut = !!openEntry;
  const canSupervise = role.canLogOthers && !isClockOut; // owner/co-owner/manager — admins who can log anyone

  // mode: 'self' = clock yourself, 'crew' = clock other people (supervisor)
  const [mode, setMode] = useState('self');
  const [selectedJobId, setSelectedJobId] = useState(openEntry?.jobId || activeJobs[0]?.id || '');
  const [selectedTask, setSelectedTask] = useState(openEntry?.task || TIME_CLOCK_TASKS[0]);
  const [selectedWorkers, setSelectedWorkers] = useState([]); // for crew mode
  const [phase, setPhase] = useState('select');
  const [location, setLocation] = useState(null);
  const [distance, setDistance] = useState(null);
  const [error, setError] = useState('');
  const [override, setOverride] = useState(false);

  const job = jobs.find(j => j.id === selectedJobId);

  // Workers eligible for clock-in (not already clocked in to this job today)
  const today = DEMO_TODAY;
  const alreadyClockedIn = new Set(
    timelog.filter(t => t.date === today && !t.clockOut).map(t => t.worker)
  );
  const eligibleWorkers = team.filter(m =>
    m.name !== role.name &&  // not the supervisor himself (use self mode for that)
    !alreadyClockedIn.has(m.name) &&
    m.role !== 'Office Manager'  // office staff don't get clocked in to jobs
  );

  const handleVerify = async () => {
    if (!job) {
      setError('Select a job before clocking in.');
      setPhase('error');
      return;
    }
    // Crew mode (admin clocking others) — skip geofence entirely, just clock them in
    if (mode === 'crew') {
      setPhase('admin-confirm');
      return;
    }
    // Self mode — actually check GPS
    setPhase('locating');
    setError('');
    try {
      const loc = await getCurrentLocation();
      setLocation(loc);
      const d = distanceMiles(loc.lat, loc.lng, job.lat, job.lng);
      setDistance(d);
      setPhase(d <= job.geofenceMiles ? 'verified' : 'denied');
    } catch (e) {
      setError(e.message);
      setPhase('error');
    }
  };

  const handleConfirm = () => {
    const verified = distance !== null && distance <= job.geofenceMiles;
    if (isClockOut) {
      onClockOut(openEntry.id, location, distance);
    } else if (mode === 'self') {
      onClockIn({
        worker: role.name,
        jobId: selectedJobId,
        task: selectedTask,
        location, distance, verified,
        override: phase === 'denied' && override,
        clockedInBy: null,
      });
    } else {
      // Crew mode — admin logs people in, no geofence flag (trusted entry)
      selectedWorkers.forEach(workerName => {
        onClockIn({
          worker: workerName,
          jobId: selectedJobId,
          task: selectedTask,
          location: null, distance: null, verified: true,  // clean entry, no flag
          override: false,
          clockedInBy: role.name, // audit: who logged it
          adminEntry: true,
        });
      });
    }
    onClose();
  };

  const toggleWorker = (name) => {
    setSelectedWorkers(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const selectAllAssigned = () => {
    if (!job) return;
    const assigned = job.crew.filter(c => eligibleWorkers.some(e => e.name === c));
    setSelectedWorkers(assigned);
  };

  const canProceed = mode === 'self' || selectedWorkers.length > 0;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 500, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        {/* HEADER */}
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{isClockOut ? 'CLOCK OUT' : 'CLOCK IN'}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* MODE TOGGLE — only for supervisors */}
          {canSupervise && phase === 'select' && (
            <div style={{ display: 'flex', background: T.panel2, padding: 3, marginBottom: 14, gap: 3 }}>
              <button
                onClick={() => { setMode('self'); setSelectedWorkers([]); }}
                style={{
                  flex: 1, background: mode === 'self' ? T.accent : 'transparent',
                  color: mode === 'self' ? '#000' : T.textDim, border: 'none',
                  padding: '10px', fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <User size={13} /> JUST ME
              </button>
              <button
                onClick={() => setMode('crew')}
                style={{
                  flex: 1, background: mode === 'crew' ? T.accent : 'transparent',
                  color: mode === 'crew' ? '#000' : T.textDim, border: 'none',
                  padding: '10px', fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                <Users size={13} /> LOG OTHERS
              </button>
            </div>
          )}

          {/* WORKER(S) DISPLAY */}
          {mode === 'self' && (
            <>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>WORKER</div>
              <div style={{ background: T.panel2, padding: '10px 12px', marginBottom: 14, fontSize: 16, fontWeight: 600 }}>{role.name}</div>
            </>
          )}

          {mode === 'crew' && phase === 'select' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>SELECT TEAM ({selectedWorkers.length} selected)</div>
                {job && (
                  <button onClick={selectAllAssigned} style={{ background: 'transparent', border: 'none', color: T.accent, fontSize: 12, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>
                    + ALL ASSIGNED
                  </button>
                )}
              </div>
              <div style={{ background: T.panel2, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
                {eligibleWorkers.length === 0 && (
                  <div style={{ padding: 14, fontSize: 14, color: T.textDim, textAlign: 'center' }}>
                    Everyone's already clocked in.
                  </div>
                )}
                {eligibleWorkers.map(m => {
                  const isSelected = selectedWorkers.includes(m.name);
                  const isAssigned = job?.crew.includes(m.name);
                  return (
                    <label
                      key={m.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        cursor: 'pointer', borderBottom: `1px solid ${T.border}`,
                        background: isSelected ? '#1a1410' : 'transparent',
                      }}
                    >
                      <input type="checkbox" checked={isSelected} onChange={() => toggleWorker(m.name)} style={{ marginRight: 4 }} />
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: m.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                        {m.initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600 }}>
                          {m.name}
                          {isAssigned && <span style={{ marginLeft: 6, fontSize: 12, color: T.accent, letterSpacing: 1 }}>● ASSIGNED</span>}
                        </div>
                        <div style={{ fontSize: 12, color: T.textDim }}>{m.role}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* JOB SELECTOR */}
          {!isClockOut ? (
            <>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>JOB</div>
              <select
                value={selectedJobId}
                onChange={e => { setSelectedJobId(e.target.value); setPhase('select'); setLocation(null); setDistance(null); }}
                disabled={phase === 'locating' || phase === 'verified'}
                style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit', marginBottom: 14 }}
              >
                {activeJobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>

              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>TASK</div>
              <select
                value={selectedTask}
                onChange={e => setSelectedTask(e.target.value)}
                disabled={phase === 'locating' || phase === 'verified'}
                style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 16, fontFamily: 'inherit', marginBottom: 14 }}
              >
                {TIME_CLOCK_TASKS.map(task => <option key={task} value={task}>{task}</option>)}
              </select>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>CLOCKED IN AT</div>
              <div style={{ background: T.panel2, padding: '10px 12px', marginBottom: 14, fontSize: 15 }}>
                <div style={{ fontWeight: 600 }}>{jobs.find(j => j.id === openEntry.jobId)?.name}</div>
                <div style={{ fontSize: 13, color: T.textDim, marginTop: 2 }}>Started {openEntry.clockIn}</div>
                <div style={{ fontSize: 13, color: T.accent, marginTop: 2 }}>{openEntry.task || 'General work'}</div>
              </div>
            </>
          )}

          {/* JOB LOCATION INFO */}
          {job && (
            <div style={{ background: T.panel2, padding: 12, marginBottom: 14, borderLeft: `3px solid ${T.accent}` }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>JOB SITE</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{job.address}</div>
              {mode === 'self' ? (
                <div style={{ fontSize: 13, color: T.textDim, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ShieldCheck size={11} /> Within {job.geofenceMiles} mile of this address
                </div>
              ) : (
                <div style={{ fontSize: 13, color: T.accent, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <User size={11} /> Admin entry — no GPS check, your name attached as verifier
                </div>
              )}
            </div>
          )}

          {/* PHASE: SELECT */}
          {phase === 'select' && (
            <button
              onClick={handleVerify}
              disabled={!canProceed}
              style={{
                width: '100%',
                background: canProceed ? T.accent : T.panel2,
                color: canProceed ? '#000' : T.textMute,
                border: 'none', padding: '14px', fontWeight: 800, fontSize: 15, letterSpacing: 1,
                cursor: canProceed ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {mode === 'crew' ? (
                <><User size={15} /> LOG IN {selectedWorkers.length} {selectedWorkers.length === 1 ? 'PERSON' : 'PEOPLE'}</>
              ) : (
                <><Navigation size={15} /> VERIFY MY LOCATION</>
              )}
            </button>
          )}

          {/* PHASE: LOCATING */}
          {phase === 'locating' && (
            <div style={{ background: T.panel2, padding: 18, textAlign: 'center' }}>
              <Loader2 size={28} style={{ color: T.accent, animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 15, color: T.text, marginTop: 10, fontWeight: 600 }}>Getting your location...</div>
              <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>Allow location access if prompted</div>
            </div>
          )}

          {/* PHASE: ADMIN-CONFIRM (admin clocking others in, no GPS) */}
          {phase === 'admin-confirm' && (
            <>
              <div style={{ background: '#1a1410', borderLeft: `3px solid ${T.accent}`, padding: 14, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <User size={18} style={{ color: T.accent }} />
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.accent, letterSpacing: 1 }}>READY TO LOG</div>
                </div>
                <div style={{ fontSize: 14, color: T.text, marginBottom: 8 }}>
                  Clocking in {selectedWorkers.length} {selectedWorkers.length === 1 ? 'person' : 'people'} at <strong>{job?.name}</strong>:
                </div>
                <div style={{ fontSize: 13, color: T.accent, marginBottom: 8, fontWeight: 700 }}>Task: {selectedTask}</div>
                <div style={{ fontSize: 14, color: T.text, lineHeight: 1.7 }}>
                  {selectedWorkers.map((name, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircle2 size={13} style={{ color: T.green }} /> {name}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
                  Logged by <span style={{ color: T.accent, fontWeight: 700 }}>{role.name}</span> · No geofence required
                </div>
              </div>
              <button onClick={handleConfirm} style={{ width: '100%', background: T.green, color: '#000', border: 'none', padding: '14px', fontWeight: 800, fontSize: 15, letterSpacing: 1, cursor: 'pointer' }}>
                ✓ CLOCK IN {selectedWorkers.length} {selectedWorkers.length === 1 ? 'PERSON' : 'PEOPLE'}
              </button>
              <button onClick={() => setPhase('select')} style={{ width: '100%', marginTop: 8, background: 'transparent', border: `1px solid ${T.border}`, color: T.textDim, padding: '10px', fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>
                BACK
              </button>
            </>
          )}

          {/* PHASE: VERIFIED */}
          {phase === 'verified' && (
            <>
              <div style={{ background: '#0a2818', borderLeft: `3px solid ${T.green}`, padding: 14, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <ShieldCheck size={18} style={{ color: T.green }} />
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.green, letterSpacing: 1 }}>LOCATION VERIFIED</div>
                </div>
                <div style={{ fontSize: 14, color: T.text }}>You're <span style={{ fontWeight: 700, color: T.green }}>{distance < 0.1 ? `${Math.round(distance * 5280)} ft` : `${distance.toFixed(2)} mi`}</span> from the job site.</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>GPS accuracy: ±{Math.round(location.accuracy)}m</div>
              </div>
              <button onClick={handleConfirm} style={{ width: '100%', background: T.green, color: '#000', border: 'none', padding: '14px', fontWeight: 800, fontSize: 15, letterSpacing: 1, cursor: 'pointer' }}>
                {isClockOut ? '✓ CONFIRM CLOCK OUT' : '✓ CONFIRM CLOCK IN'}
              </button>
            </>
          )}

          {/* PHASE: DENIED */}
          {phase === 'denied' && (
            <>
              <div style={{ background: '#2d0e0e', borderLeft: `3px solid ${T.red}`, padding: 14, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <ShieldAlert size={18} style={{ color: T.red }} />
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.red, letterSpacing: 1 }}>OUTSIDE GEOFENCE</div>
                </div>
                <div style={{ fontSize: 14, color: T.text }}>You're <span style={{ fontWeight: 700, color: T.red }}>{distance.toFixed(2)} miles</span> from the job site.</div>
                <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>Geofence radius: {job.geofenceMiles} mile</div>
              </div>

              <div style={{ fontSize: 14, color: T.textDim, marginBottom: 10, lineHeight: 1.5 }}>
                {mode === 'self'
                  ? "You can't clock in from here. Get to the job site and try again, or contact your foreman if you're at a different work location."
                  : "You're not on the job site. Drive over and try again, or use override if there's a legit reason."}
              </div>

              {role.canEdit && (
                <>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 10, background: T.panel2, marginBottom: 10, cursor: 'pointer', fontSize: 13, color: T.textDim }}>
                    <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} style={{ marginTop: 2 }} />
                    <span><strong style={{ color: T.accent }}>Manager override:</strong> log this anyway and flag for review (e.g. picking up materials, off-site task)</span>
                  </label>
                  {override && (
                    <button onClick={handleConfirm} style={{ width: '100%', background: T.accent, color: '#000', border: 'none', padding: '12px', fontWeight: 700, fontSize: 14, letterSpacing: 1, cursor: 'pointer', marginBottom: 8 }}>
                      LOG WITH OVERRIDE FLAG
                    </button>
                  )}
                </>
              )}

              {isClockOut && (
                <button onClick={handleConfirm} style={{ width: '100%', background: T.red, color: '#fff', border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer', marginBottom: 8 }}>
                  MANUAL CLOCK OUT · FLAG FOR REVIEW
                </button>
              )}
              <button onClick={() => setPhase('select')} style={{ width: '100%', background: T.panel2, color: T.text, border: `1px solid ${T.border}`, padding: '12px', fontWeight: 700, fontSize: 14, letterSpacing: 1, cursor: 'pointer' }}>
                TRY AGAIN
              </button>
            </>
          )}

          {/* PHASE: ERROR */}
          {phase === 'error' && (
            <>
              <div style={{ background: '#2d0e0e', borderLeft: `3px solid ${T.red}`, padding: 14, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <AlertTriangle size={18} style={{ color: T.red }} />
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.red, letterSpacing: 1 }}>LOCATION ERROR</div>
                </div>
                <div style={{ fontSize: 14, color: T.text }}>{error}</div>
                <div style={{ fontSize: 13, color: T.textDim, marginTop: 6, lineHeight: 1.5 }}>Check that location services are on for this app. On iPhone: Settings → Privacy → Location.</div>
              </div>
              {role.canEdit && !isClockOut && (
                <button onClick={handleConfirm} style={{ width: '100%', background: T.accent, color: '#000', border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer', marginBottom: 8 }}>
                  MANUAL CLOCK IN · FLAG FOR REVIEW
                </button>
              )}
              {isClockOut && (
                <button onClick={handleConfirm} style={{ width: '100%', background: T.red, color: '#fff', border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer', marginBottom: 8 }}>
                  MANUAL CLOCK OUT · FLAG FOR REVIEW
                </button>
              )}
              <button onClick={() => setPhase('select')} style={{ width: '100%', background: T.panel2, color: T.text, border: `1px solid ${T.border}`, padding: '12px', fontWeight: 700, fontSize: 14, letterSpacing: 1, cursor: 'pointer' }}>
                TRY AGAIN
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — TIME LOG
// ============================================================
function TimeLogView({ timelog, jobs, team, role, onClockIn, onClockOut, onStartBreak, onEndBreak, onUpdateEntry, onDeleteEntry, onOpenTimeClock }) {
  const [filterJob, setFilterJob] = useState('all');
  const [filterWorker, setFilterWorker] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState(null);
  const [nowTick, setNowTick] = useState(new Date());

  // is current user clocked in already?
  const openEntry = timelog.find(t => t.worker === role.name && !t.clockOut);
  const openBreak = openEntry?.breaks?.find(b => !b.end);
  const liveHours = openEntry ? payableHours(openEntry.clockIn, fmtTime(nowTick), openEntry.breaks || []) : 0;

  useEffect(() => {
    if (!openEntry) return undefined;
    const id = setInterval(() => setNowTick(new Date()), 30000);
    return () => clearInterval(id);
  }, [openEntry?.id]);

  const filtered = timelog.filter(t => {
    if (filterJob !== 'all' && t.jobId !== filterJob) return false;
    if (filterWorker !== 'all' && t.worker !== filterWorker) return false;
    return true;
  });

  const totalHours = filtered.reduce((s, t) => s + t.hours, 0);
  const byWorker = {};
  filtered.forEach(t => { byWorker[t.worker] = (byWorker[t.worker] || 0) + t.hours; });
  const flaggedCount = filtered.filter(t => !t.verified).length;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Time Log</div>
        <button
          onClick={() => onOpenTimeClock ? onOpenTimeClock() : setShowModal(true)}
          style={{
            background: openEntry ? T.red : T.accent, color: openEntry ? '#fff' : '#000',
            border: 'none', padding: '10px 16px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {openEntry ? <><Clock size={14} /> CLOCK OUT</> : <><ShieldCheck size={14} /> CLOCK IN</>}
        </button>
      </div>

      {openEntry && (
        <div style={{ background: T.panel, borderLeft: `3px solid ${T.green}`, padding: 12, marginBottom: 14, fontSize: 14 }}>
          <span style={{ color: T.green, fontWeight: 700, letterSpacing: 1, fontSize: 13 }}>● CURRENTLY CLOCKED IN</span>
          <span style={{ color: T.textDim, marginLeft: 10 }}>at {jobs.find(j => j.id === openEntry.jobId)?.name} since {openEntry.clockIn}</span>
        </div>
      )}

      {openEntry && (
        <div style={{ background: T.panel, borderLeft: `3px solid ${openBreak ? T.yellow : T.green}`, padding: 14, marginBottom: 14, fontSize: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: openBreak ? T.yellow : T.green, fontWeight: 800, letterSpacing: 1, fontSize: 13 }}>
                {openBreak ? 'BREAK IN PROGRESS' : 'WORK SESSION'}
              </div>
              <div style={{ color: T.textDim, marginTop: 4 }}>
                {openEntry.task || 'General work'} · payable time {liveHours}h
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {openBreak ? (
                <button onClick={() => onEndBreak(openEntry.id)} style={{ background: T.yellow, color: '#000', border: 'none', padding: '8px 10px', fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Coffee size={13} /> END BREAK
                </button>
              ) : (
                <button onClick={() => onStartBreak(openEntry.id)} style={{ background: T.panel2, color: T.yellow, border: `1px solid ${T.yellow}`, padding: '8px 10px', fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Coffee size={13} /> START BREAK
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatCard label="ENTRIES" value={filtered.length} accent={T.blue} />
        <StatCard label="TOTAL HOURS" value={`${totalHours}h`} accent={T.accent} />
        <StatCard label="WORKERS" value={Object.keys(byWorker).length} accent={T.green} />
        <StatCard label="FLAGGED" value={flaggedCount} accent={flaggedCount > 0 ? T.red : T.textMute} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={filterJob} onChange={e => setFilterJob(e.target.value)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
          <option value="all">All Jobs</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
        <select value={filterWorker} onChange={e => setFilterWorker(e.target.value)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
          <option value="all">All Workers</option>
          {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
      </div>

      <div style={{ background: T.panel, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '70px 110px 1fr 130px 100px 70px 110px', padding: '10px 14px', fontSize: 12, color: T.textDim, fontWeight: 700, letterSpacing: 1, borderBottom: `1px solid ${T.border}`, minWidth: 760 }}>
          <div>DATE</div><div>WORKER</div><div>JOB</div><div>TASK</div><div>CLOCK</div><div>HRS</div><div>VERIFIED</div>
        </div>
        {filtered.map(t => {
          const job = jobs.find(j => j.id === t.jobId);
          const canEditRow = role.canEdit;
          const isOpen = !t.clockOut;
          // Count other jobs this worker hit on this date
          const otherJobsToday = timelog.filter(o => o.worker === t.worker && o.date === t.date && o.jobId !== t.jobId).length;
          return (
            <div
              key={t.id}
              onClick={canEditRow ? () => setEditingEntry(t) : undefined}
              style={{
                display: 'grid', gridTemplateColumns: '70px 110px 1fr 130px 100px 70px 110px',
                padding: '10px 14px', fontSize: 14, borderBottom: `1px solid ${T.border}`,
                alignItems: 'center', minWidth: 760,
                cursor: canEditRow ? 'pointer' : 'default',
                background: isOpen ? '#0d1610' : 'transparent',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (canEditRow) e.currentTarget.style.background = T.panel2; }}
              onMouseLeave={e => { if (canEditRow) e.currentTarget.style.background = isOpen ? '#0d1610' : 'transparent'; }}
            >
              <div style={{ color: T.textDim }}>{t.date.slice(5)}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{t.worker}{isOpen && <span style={{ color: T.green, fontSize: 12, marginLeft: 4 }}>●</span>}</div>
                {t.clockedInBy && <div style={{ fontSize: 12, color: T.textMute, marginTop: 1 }}>by {t.clockedInBy}</div>}
              </div>
              <div style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {job?.name.split(' — ')[0] || '—'}
                {otherJobsToday > 0 && (
                  <span title={`This worker hit ${otherJobsToday + 1} jobs on ${t.date}`} style={{ marginLeft: 6, fontSize: 12, background: T.accent, color: '#000', padding: '1px 5px', letterSpacing: 0.5, fontWeight: 800 }}>
                    +{otherJobsToday}
                  </span>
                )}
              </div>
              <div style={{ color: T.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{t.task || 'General work'}</div>
              <div style={{ color: T.text, fontSize: 13 }}>{t.clockIn || '—'}{t.clockOut && <span style={{ color: T.textMute }}> – {t.clockOut}</span>}{isOpen && <span style={{ color: T.green }}> – open</span>}</div>
              <div style={{ color: T.accent, fontWeight: 700 }}>{t.hours}h</div>
              <div>
                {t.adminEntry ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: T.accent, fontSize: 12, fontWeight: 700, letterSpacing: 1 }} title={`Logged by ${t.clockedInBy}`}>
                    <User size={11} /> ADMIN
                  </span>
                ) : t.verified ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: T.green, fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
                    <ShieldCheck size={11} /> {t.distance < 0.1 ? `${Math.round(t.distance * 5280)}ft` : `${t.distance.toFixed(2)}mi`}
                  </span>
                ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: T.red, fontSize: 12, fontWeight: 700, letterSpacing: 1 }} title={t.flagReason}>
                    <ShieldAlert size={11} /> {t.distance?.toFixed(2)}mi
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ padding: 30, textAlign: 'center', color: T.textDim, fontSize: 14 }}>No entries match.</div>
        )}
      </div>

      {role.canEdit && (
        <div style={{ fontSize: 12, color: T.textMute, marginTop: 8, letterSpacing: 1 }}>
          TIP: TAP ANY ENTRY TO EDIT (FIX TIMES, REASSIGN JOB, DELETE)
        </div>
      )}

      <div style={{ fontSize: 12, color: T.textDim, marginTop: 12, letterSpacing: 1, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ShieldCheck size={11} style={{ color: T.green }} /> WITHIN GEOFENCE</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ShieldAlert size={11} style={{ color: T.red }} /> OUTSIDE GEOFENCE — REVIEW</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><User size={11} style={{ color: T.accent }} /> LOGGED BY ADMIN</span>
      </div>

      {showModal && (
        <ClockInModal
          jobs={jobs}
          role={role}
          team={team}
          timelog={timelog}
          onClose={() => setShowModal(false)}
          onClockIn={onClockIn}
          openEntry={openEntry}
          onClockOut={onClockOut}
        />
      )}

      {editingEntry && (
        <EditTimeEntryModal
          entry={editingEntry}
          jobs={jobs}
          team={team}
          onClose={() => setEditingEntry(null)}
          onUpdate={onUpdateEntry}
          onDelete={onDeleteEntry}
        />
      )}
    </div>
  );
}

// ============================================================
// EDIT TIME ENTRY MODAL — supervisor can fix times, change job, delete
// ============================================================
function EditTimeEntryModal({ entry, jobs, team, onClose, onUpdate, onDelete }) {
  const [worker, setWorker] = useState(entry.worker);
  const [jobId, setJobId] = useState(entry.jobId);
  const [task, setTask] = useState(entry.task || 'General work');
  const [clockIn, setClockIn] = useState(entry.clockIn || '');
  const [clockOut, setClockOut] = useState(entry.clockOut || '');
  const [hours, setHours] = useState(entry.hours);
  const [notes, setNotes] = useState(entry.flagReason || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Auto-calc hours when both times present
  const recalc = (ci, co) => {
    if (!ci || !co) return;
    const parse = (t) => {
      const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
      if (!m) return null;
      let h = parseInt(m[1]); const min = parseInt(m[2]);
      const meridiem = (m[3] || '').toUpperCase();
      if (meridiem === 'PM' && h < 12) h += 12;
      if (meridiem === 'AM' && h === 12) h = 0;
      return h + min / 60;
    };
    const start = parse(ci); const end = parse(co);
    if (start !== null && end !== null && end > start) {
      setHours(Math.round((end - start) * 10) / 10);
    }
  };

  const save = () => {
    onUpdate(entry.id, {
      worker, jobId, task,
      clockIn: clockIn || null,
      clockOut: clockOut || null,
      hours: Number(hours) || 0,
      flagReason: notes || entry.flagReason,
      manuallyEdited: true,
    });
    onClose();
  };

  const handleDelete = () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onDelete(entry.id);
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 480, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>EDIT TIME ENTRY</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {entry.manuallyEdited && (
            <div style={{ background: T.panel2, borderLeft: `3px solid ${T.accent}`, padding: 10, marginBottom: 14, fontSize: 13, color: T.textDim }}>
              ⚠ This entry has been manually edited before.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>WORKER</div>
              <select value={worker} onChange={e => setWorker(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }}>
                {team.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>JOB</div>
              <select value={jobId} onChange={e => setJobId(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }}>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name.split(' — ')[0]}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>TASK</div>
            <select value={task} onChange={e => setTask(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }}>
              {['General work', ...TIME_CLOCK_TASKS].map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>CLOCK IN</div>
              <input value={clockIn} onChange={e => { setClockIn(e.target.value); recalc(e.target.value, clockOut); }} placeholder="7:00 AM" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>CLOCK OUT</div>
              <input value={clockOut} onChange={e => { setClockOut(e.target.value); recalc(clockIn, e.target.value); }} placeholder="3:30 PM" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>HOURS (auto-calc, can override)</div>
            <input type="number" step="0.1" value={hours} onChange={e => setHours(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.accent, padding: '10px 12px', fontSize: 18, fontFamily: 'inherit', fontWeight: 700 }} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NOTES (why edited?)</div>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Phone died — manually entered" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }} />
          </div>

          {entry.distance !== null && entry.distance !== undefined && (
            <div style={{ background: T.panel2, padding: 10, marginBottom: 14, fontSize: 13, color: T.textDim }}>
              Original GPS: {entry.distance < 0.1 ? `${Math.round(entry.distance * 5280)}ft` : `${entry.distance.toFixed(2)}mi`} from job site
              {entry.clockedInBy && <span style={{ marginLeft: 6 }}>· Clocked in by {entry.clockedInBy}</span>}
            </div>
          )}

          <button onClick={save} style={{ width: '100%', background: T.green, color: '#000', border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer', marginBottom: 8 }}>
            ✓ SAVE CHANGES
          </button>
          <button onClick={handleDelete} style={{ width: '100%', background: confirmDelete ? T.red : T.panel2, color: confirmDelete ? '#fff' : T.red, border: `1px solid ${T.red}`, padding: '10px', fontWeight: 700, fontSize: 13, letterSpacing: 1, cursor: 'pointer' }}>
            {confirmDelete ? 'TAP AGAIN TO CONFIRM DELETE' : 'DELETE ENTRY'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — EXPENSES (receipts, AI parsing, allocations)
// ============================================================
function ExpensesView({ expenses, jobs, role, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [filterJob, setFilterJob] = useState('all');
  const [editingId, setEditingId] = useState(null);

  const filtered = filterJob === 'all'
    ? expenses
    : expenses.filter(e => e.allocations.some(a => a.jobId === filterJob));

  const totalSpent = filtered.reduce((s, e) => s + e.total, 0);
  const unallocated = filtered.filter(e => {
    const allocSum = e.allocations.reduce((s, a) => s + a.amount, 0);
    return Math.abs(allocSum - e.total) > 0.01;
  });

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Expenses & Receipts</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setShowManual(true)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '10px 14px', fontWeight: 700, fontSize: 14, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Plus size={13} /> MANUAL
          </button>
          <button onClick={() => setShowAdd(true)} style={{ background: T.accent, color: '#000', border: 'none', padding: '10px 16px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Camera size={14} /> SCAN RECEIPT
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 16 }}>
        <StatCard label="RECEIPTS" value={filtered.length} accent={T.blue} />
        <StatCard label="TOTAL SPENT" value={fmtMoney(totalSpent)} accent={T.accent} />
        <StatCard label="UNALLOCATED" value={unallocated.length} accent={unallocated.length > 0 ? T.red : T.textMute} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={filterJob} onChange={e => setFilterJob(e.target.value)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
          <option value="all">All Jobs</option>
          {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 && (
        <div style={{ background: T.panel, padding: 30, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
          No expenses yet. Tap SCAN RECEIPT or MANUAL to add one.
        </div>
      )}

      {filtered.map(exp => <ExpenseRow key={exp.id} expense={exp} jobs={jobs} onEdit={() => setEditingId(exp.id)} onDelete={() => onDelete(exp.id)} />)}

      {showAdd && <ReceiptScanModal jobs={jobs} role={role} onClose={() => setShowAdd(false)} onAdd={onAdd} />}
      {showManual && <ManualExpenseModal jobs={jobs} role={role} onClose={() => setShowManual(false)} onAdd={onAdd} />}
      {editingId && <ExpenseEditModal expense={expenses.find(e => e.id === editingId)} jobs={jobs} onClose={() => setEditingId(null)} onUpdate={onUpdate} />}
    </div>
  );
}

function ExpenseRow({ expense, jobs, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const allocSum = expense.allocations.reduce((s, a) => s + a.amount, 0);
  const isFullyAllocated = Math.abs(allocSum - expense.total) < 0.01;
  const splitJobs = expense.allocations.length > 1;

  return (
    <div style={{ background: T.panel, marginBottom: 8, borderLeft: `3px solid ${isFullyAllocated ? T.green : T.red}` }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <Receipt size={18} style={{ color: T.accent, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {expense.vendor}
              {expense.paymentMethod && PAYMENT_METHOD[expense.paymentMethod] && (
                <span style={{ background: PAYMENT_METHOD[expense.paymentMethod].color, color: '#000', padding: '1px 6px', fontSize: 12, letterSpacing: 1, fontWeight: 800 }}>
                  {PAYMENT_METHOD[expense.paymentMethod].short}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 2 }}>
              {expense.date} · {expense.items.length} items · paid by {expense.paidBy}
              {splitJobs && <span style={{ color: T.accent, marginLeft: 6 }}>· SPLIT {expense.allocations.length} jobs</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.accent }}>{fmtMoney(expense.total)}</div>
          {expanded ? <ChevronUp size={16} style={{ color: T.textDim }} /> : <ChevronDown size={16} style={{ color: T.textDim }} />}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: `1px solid ${T.border}` }}>
          {!isFullyAllocated && (
            <div style={{ background: '#2d0e0e', borderLeft: `3px solid ${T.red}`, padding: 10, margin: '12px 0', fontSize: 13, color: T.text }}>
              ⚠ Allocation mismatch: {fmtMoney(allocSum)} allocated of {fmtMoney(expense.total)} total. Tap edit to fix.
            </div>
          )}

          <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, fontWeight: 700, margin: '12px 0 6px' }}>ITEMS</div>
          {expense.items.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < expense.items.length - 1 ? `1px solid ${T.border}` : 'none', fontSize: 14 }}>
              <span style={{ color: T.text, flex: 1 }}>{item.description}</span>
              <span style={{ color: T.textDim, fontWeight: 600 }}>{fmtMoney(item.amount)}</span>
            </div>
          ))}

          <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, fontWeight: 700, margin: '14px 0 6px' }}>ALLOCATED TO</div>
          {expense.allocations.map((alloc, i) => {
            const job = jobs.find(j => j.id === alloc.jobId);
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14 }}>
                <span style={{ color: T.text }}>{job?.name || 'Unknown job'}</span>
                <span style={{ color: T.green, fontWeight: 700 }}>{fmtMoney(alloc.amount)}</span>
              </div>
            );
          })}

          {expense.notes && (
            <div style={{ marginTop: 10, padding: 10, background: T.bg, fontSize: 14, color: T.textDim, fontStyle: 'italic' }}>
              {expense.notes}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={onEdit} style={{ flex: 1, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px', fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>EDIT / RE-ALLOCATE</button>
            <button onClick={onDelete} style={{ background: T.panel2, border: `1px solid ${T.red}`, color: T.red, padding: '8px 14px', fontSize: 13, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>DELETE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// RECEIPT SCAN MODAL — uploads receipt to Claude API for parsing
// ============================================================
function ReceiptScanModal({ jobs, role, onClose, onAdd }) {
  const [phase, setPhase] = useState('upload'); // upload | parsing | review | error
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');

  // Allocation state for review phase
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState('');
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cod-card');

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const callClaudeAPI = async (base64Data, mediaType) => {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: `You are a receipt parser for a construction company. Extract structured data from this receipt and return ONLY valid JSON, no other text, no markdown fences. Use this exact format:
{
  "vendor": "Store name",
  "date": "YYYY-MM-DD",
  "total": 123.45,
  "items": [
    {"description": "Item description", "amount": 12.34}
  ]
}
Rules:
- For each line item, extract the description and the line total (price × qty if applicable).
- If a line shows "QTY 3 @ $5.00 = $15.00", description should be "Item name — 3 ea" and amount should be 15.00.
- Skip subtotal, tax, total — only include actual purchased items.
- If you can't read a value clearly, make your best guess. Don't add explanations.
- Return JSON only.` }
          ]
        }]
      })
    });
    const data = await response.json();
    const textBlock = data.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No response from AI');
    const cleaned = textBlock.text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  };

  const handleParse = async () => {
    if (!file) return;
    setPhase('parsing');
    setError('');
    try {
      // Convert to base64
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.onerror = () => rej(new Error('Failed to read file'));
        r.readAsDataURL(file);
      });

      const result = await callClaudeAPI(base64, file.type);

      setVendor(result.vendor || '');
      setDate(result.date || '2026-04-29');
      setTotal(result.total || 0);
      setItems(result.items || []);
      // Default: allocate full total to first active job
      const activeJob = jobs.find(j => j.status === 'active' || j.status === 'on-site' || j.status === 'in-progress') || jobs[0];
      setAllocations([{ jobId: activeJob?.id || '', amount: result.total || 0 }]);
      setParsed(result);
      setPhase('review');
    } catch (e) {
      setError(e.message || 'Failed to parse receipt. Try a clearer photo.');
      setPhase('error');
    }
  };

  const updateAlloc = (i, key, val) => {
    setAllocations(prev => prev.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
  };

  const addAlloc = () => {
    setAllocations(prev => [...prev, { jobId: jobs[0]?.id || '', amount: 0 }]);
  };

  const removeAlloc = (i) => {
    setAllocations(prev => prev.filter((_, idx) => idx !== i));
  };

  const allocSum = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  const allocOk = Math.abs(allocSum - total) < 0.01;

  const save = () => {
    onAdd({
      id: 'e' + Date.now(),
      date,
      vendor,
      total: Number(total),
      items,
      allocations: allocations.map(a => ({ jobId: a.jobId, amount: Number(a.amount) })),
      paidBy: role.name,
      paymentMethod,
      receiptUrl: previewUrl,
      notes,
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 560, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>SCAN RECEIPT</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* PHASE: UPLOAD */}
          {phase === 'upload' && (
            <>
              <label htmlFor="receipt-upload" style={{ display: 'block', background: T.panel2, border: `2px dashed ${T.border}`, padding: 30, textAlign: 'center', cursor: 'pointer', marginBottom: 14 }}>
                {previewUrl ? (
                  <img src={previewUrl} alt="receipt" style={{ maxWidth: '100%', maxHeight: 240, display: 'block', margin: '0 auto' }} />
                ) : (
                  <>
                    <Upload size={32} style={{ color: T.accent, marginBottom: 10 }} />
                    <div style={{ fontSize: 15, color: T.text, fontWeight: 600 }}>Tap to take a photo or upload</div>
                    <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>JPG, PNG, or HEIC · Photo of paper receipt works best</div>
                  </>
                )}
                <input id="receipt-upload" type="file" accept="image/*" capture="environment" onChange={e => handleFile(e.target.files?.[0])} style={{ display: 'none' }} />
              </label>

              {previewUrl && (
                <button onClick={handleParse} style={{ width: '100%', background: T.accent, color: '#000', border: 'none', padding: '14px', fontWeight: 800, fontSize: 15, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <Sparkles size={15} /> READ RECEIPT WITH AI
                </button>
              )}
            </>
          )}

          {/* PHASE: PARSING */}
          {phase === 'parsing' && (
            <div style={{ background: T.panel2, padding: 30, textAlign: 'center' }}>
              <Loader2 size={32} style={{ color: T.accent, animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 16, color: T.text, marginTop: 12, fontWeight: 700 }}>Reading your receipt...</div>
              <div style={{ fontSize: 13, color: T.textDim, marginTop: 4 }}>AI is extracting vendor, items, and totals</div>
            </div>
          )}

          {/* PHASE: REVIEW */}
          {phase === 'review' && (
            <>
              <div style={{ background: '#0a2818', borderLeft: `3px solid ${T.green}`, padding: 12, marginBottom: 14, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <CheckCircle2 size={16} style={{ color: T.green }} />
                <span><strong style={{ color: T.green }}>Got it.</strong> Review and adjust below if needed.</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>VENDOR</div>
                  <input value={vendor} onChange={e => setVendor(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
                </div>
                <div>
                  <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>DATE</div>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }} />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>TOTAL</div>
                <input type="number" step="0.01" value={total} onChange={e => setTotal(Number(e.target.value))} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.accent, padding: '10px 12px', fontSize: 20, fontFamily: 'inherit', fontWeight: 700 }} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6, fontWeight: 700 }}>ITEMS PARSED ({items.length})</div>
                <div style={{ background: T.panel2, padding: 10, maxHeight: 160, overflowY: 'auto' }}>
                  {items.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14, borderBottom: i < items.length - 1 ? `1px solid ${T.border}` : 'none' }}>
                      <span style={{ color: T.text, flex: 1, paddingRight: 10 }}>{item.description}</span>
                      <span style={{ color: T.textDim, fontWeight: 600 }}>{fmtMoney(item.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: T.accent, letterSpacing: 1, fontWeight: 700 }}>ALLOCATE TO JOBS</div>
                  <button onClick={addAlloc} style={{ background: 'transparent', border: 'none', color: T.accent, fontSize: 13, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>+ SPLIT</button>
                </div>

                {allocations.map((alloc, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                    <select value={alloc.jobId} onChange={e => updateAlloc(i, 'jobId', e.target.value)} style={{ flex: 1, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
                      {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </select>
                    <input type="number" step="0.01" value={alloc.amount} onChange={e => updateAlloc(i, 'amount', Number(e.target.value))} style={{ width: 100, background: T.panel2, border: `1px solid ${T.border}`, color: T.green, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }} />
                    {allocations.length > 1 && (
                      <button onClick={() => removeAlloc(i)} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}><X size={14} /></button>
                    )}
                  </div>
                ))}

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 8, padding: '8px 10px', background: T.bg }}>
                  <span style={{ color: T.textDim, letterSpacing: 1, fontWeight: 700 }}>ALLOCATED</span>
                  <span style={{ color: allocOk ? T.green : T.red, fontWeight: 700 }}>
                    {fmtMoney(allocSum)} / {fmtMoney(total)}
                    {!allocOk && <span style={{ marginLeft: 6 }}>{allocSum > total ? '⚠ OVER' : `(${fmtMoney(total - allocSum)} left)`}</span>}
                  </span>
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>PAYMENT METHOD</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', gap: 4 }}>
                  {Object.entries(PAYMENT_METHOD).filter(([k]) => k !== 'other').map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setPaymentMethod(k)}
                      style={{
                        background: paymentMethod === k ? v.color : T.panel2,
                        color: paymentMethod === k ? '#000' : T.textDim,
                        border: paymentMethod === k ? `1px solid ${v.color}` : `1px solid ${T.border}`,
                        padding: '8px 6px', fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
                      }}
                    >
                      {v.short}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NOTES (OPTIONAL)</div>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Picked up Monday morning" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }} />
              </div>

              <button onClick={save} disabled={!allocOk || !vendor} style={{ width: '100%', background: allocOk && vendor ? T.green : T.panel2, color: allocOk && vendor ? '#000' : T.textMute, border: 'none', padding: '14px', fontWeight: 800, fontSize: 15, letterSpacing: 1, cursor: allocOk && vendor ? 'pointer' : 'not-allowed' }}>
                ✓ SAVE RECEIPT
              </button>
            </>
          )}

          {/* PHASE: ERROR */}
          {phase === 'error' && (
            <>
              <div style={{ background: '#2d0e0e', borderLeft: `3px solid ${T.red}`, padding: 14, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <AlertTriangle size={18} style={{ color: T.red }} />
                  <div style={{ fontSize: 16, fontWeight: 800, color: T.red, letterSpacing: 1 }}>COULDN'T READ RECEIPT</div>
                </div>
                <div style={{ fontSize: 14, color: T.text }}>{error}</div>
              </div>
              <button onClick={() => setPhase('upload')} style={{ width: '100%', background: T.panel2, color: T.text, border: `1px solid ${T.border}`, padding: '12px', fontWeight: 700, fontSize: 14, letterSpacing: 1, cursor: 'pointer' }}>
                TRY AGAIN
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EXPENSE EDIT MODAL — re-allocate after creation
// ============================================================
// ============================================================
// MANUAL EXPENSE MODAL — type in expense without scanning a receipt
// ============================================================
function ManualExpenseModal({ jobs, role, onClose, onAdd }) {
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState('2026-04-29');
  const [total, setTotal] = useState('');
  const [items, setItems] = useState([{ description: '', amount: '' }]);
  const [allocations, setAllocations] = useState([{ jobId: jobs[0]?.id || '', amount: '' }]);
  const [paymentMethod, setPaymentMethod] = useState('cod-card');
  const [notes, setNotes] = useState('');

  const updateItem = (i, key, val) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [key]: val } : it));
  };
  const addItem = () => setItems(prev => [...prev, { description: '', amount: '' }]);
  const removeItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const updateAlloc = (i, key, val) => {
    setAllocations(prev => prev.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
  };
  const addAlloc = () => setAllocations(prev => [...prev, { jobId: jobs[0]?.id || '', amount: '' }]);
  const removeAlloc = (i) => setAllocations(prev => prev.filter((_, idx) => idx !== i));

  // Auto-calculate total from line items if user adds them
  const itemSum = items.reduce((s, i) => s + (parseFloat(i.amount) || 0), 0);
  const useItemSum = itemSum > 0 && !total;
  const effectiveTotal = parseFloat(total) || itemSum;

  // Auto-allocate full total to first job if only one allocation row and amount is empty
  const allocSum = allocations.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
  const allocOk = effectiveTotal > 0 && Math.abs(allocSum - effectiveTotal) < 0.01;
  const canSave = vendor && date && effectiveTotal > 0 && allocOk;

  // Quick-fill: dump full total to a single job
  const quickAllocate = () => {
    if (allocations.length === 1 && effectiveTotal > 0) {
      updateAlloc(0, 'amount', effectiveTotal);
    }
  };

  const save = () => {
    // Filter out blank items
    const cleanItems = items
      .filter(i => i.description && parseFloat(i.amount) > 0)
      .map(i => ({ description: i.description, amount: parseFloat(i.amount) }));

    onAdd({
      id: 'e' + Date.now(),
      date,
      vendor,
      total: effectiveTotal,
      items: cleanItems.length > 0 ? cleanItems : [{ description: vendor + ' purchase', amount: effectiveTotal }],
      allocations: allocations
        .filter(a => a.jobId && parseFloat(a.amount) > 0)
        .map(a => ({ jobId: a.jobId, amount: parseFloat(a.amount) })),
      paidBy: role.name,
      paymentMethod,
      receiptUrl: null,
      notes,
    });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 540, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 800 }}>QUEST</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>MANUAL EXPENSE</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          {/* VENDOR + DATE */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>VENDOR *</div>
              <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="e.g. Home Depot, ABC Supply" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>DATE *</div>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }} />
            </div>
          </div>

          {/* LINE ITEMS (optional) */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>LINE ITEMS (OPTIONAL)</div>
              <button onClick={addItem} style={{ background: 'transparent', border: 'none', color: T.accent, fontSize: 13, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>+ ADD ITEM</button>
            </div>

            {items.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input
                  value={item.description}
                  onChange={e => updateItem(i, 'description', e.target.value)}
                  placeholder="Description"
                  style={{ flex: 1, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}
                />
                <input
                  type="number" step="0.01"
                  value={item.amount}
                  onChange={e => updateItem(i, 'amount', e.target.value)}
                  placeholder="0.00"
                  style={{ width: 90, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', textAlign: 'right' }}
                />
                {items.length > 1 && (
                  <button onClick={() => removeItem(i)} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}><X size={14} /></button>
                )}
              </div>
            ))}

            {useItemSum && (
              <div style={{ fontSize: 12, color: T.green, marginTop: 4, letterSpacing: 1 }}>
                ✓ ITEMS TOTAL: {fmtMoney(itemSum)} — will auto-fill total below
              </div>
            )}
          </div>

          {/* TOTAL */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>TOTAL *</div>
            <input
              type="number" step="0.01"
              value={total}
              onChange={e => setTotal(e.target.value)}
              placeholder={itemSum > 0 ? itemSum.toFixed(2) : '0.00'}
              style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.accent, padding: '10px 12px', fontSize: 20, fontFamily: 'inherit', fontWeight: 700 }}
            />
            {effectiveTotal > 0 && (
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 4 }}>
                Using {fmtMoney(effectiveTotal)} {useItemSum ? '(from line items)' : '(typed)'}
              </div>
            )}
          </div>

          {/* PAYMENT METHOD */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 6 }}>PAYMENT METHOD</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', gap: 4 }}>
              {Object.entries(PAYMENT_METHOD).filter(([k]) => k !== 'other').map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => setPaymentMethod(k)}
                  style={{
                    background: paymentMethod === k ? v.color : T.panel2,
                    color: paymentMethod === k ? '#000' : T.textDim,
                    border: paymentMethod === k ? `1px solid ${v.color}` : `1px solid ${T.border}`,
                    padding: '8px 6px', fontSize: 12, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
                  }}
                >
                  {v.short}
                </button>
              ))}
            </div>
          </div>

          {/* ALLOCATE TO JOBS */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: T.accent, letterSpacing: 1, fontWeight: 700 }}>ALLOCATE TO JOBS *</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {effectiveTotal > 0 && allocations.length === 1 && (
                  <button onClick={quickAllocate} style={{ background: 'transparent', border: 'none', color: T.green, fontSize: 13, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>USE TOTAL</button>
                )}
                <button onClick={addAlloc} style={{ background: 'transparent', border: 'none', color: T.accent, fontSize: 13, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>+ SPLIT</button>
              </div>
            </div>

            {allocations.map((alloc, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <select value={alloc.jobId} onChange={e => updateAlloc(i, 'jobId', e.target.value)} style={{ flex: 1, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
                  <option value="">— Select job —</option>
                  {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
                <input type="number" step="0.01" value={alloc.amount} onChange={e => updateAlloc(i, 'amount', e.target.value)} placeholder="0.00" style={{ width: 100, background: T.panel2, border: `1px solid ${T.border}`, color: T.green, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', fontWeight: 700, textAlign: 'right' }} />
                {allocations.length > 1 && (
                  <button onClick={() => removeAlloc(i)} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer', padding: 4 }}><X size={14} /></button>
                )}
              </div>
            ))}

            {effectiveTotal > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 8, padding: '8px 10px', background: T.bg }}>
                <span style={{ color: T.textDim, letterSpacing: 1, fontWeight: 700 }}>ALLOCATED</span>
                <span style={{ color: allocOk ? T.green : T.red, fontWeight: 700 }}>
                  {fmtMoney(allocSum)} / {fmtMoney(effectiveTotal)}
                  {!allocOk && <span style={{ marginLeft: 6 }}>{allocSum > effectiveTotal ? '⚠ OVER' : `(${fmtMoney(effectiveTotal - allocSum)} left)`}</span>}
                </span>
              </div>
            )}
          </div>

          {/* NOTES */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NOTES (OPTIONAL)</div>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Paid cash on delivery, no receipt" style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }} />
          </div>

          <button
            onClick={save}
            disabled={!canSave}
            style={{
              width: '100%',
              background: canSave ? T.green : T.panel2,
              color: canSave ? '#000' : T.textMute,
              border: 'none', padding: '14px',
              fontWeight: 800, fontSize: 15, letterSpacing: 1,
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            ✓ SAVE EXPENSE
          </button>

          {!canSave && (
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 8, textAlign: 'center' }}>
              {!vendor && 'Add vendor name. '}
              {effectiveTotal === 0 && 'Add a total. '}
              {effectiveTotal > 0 && !allocOk && 'Allocations must equal total.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ExpenseEditModal({ expense, jobs, onClose, onUpdate }) {
  const [allocations, setAllocations] = useState([...expense.allocations]);
  const [notes, setNotes] = useState(expense.notes || '');

  const updateAlloc = (i, key, val) => setAllocations(prev => prev.map((a, idx) => idx === i ? { ...a, [key]: val } : a));
  const addAlloc = () => setAllocations(prev => [...prev, { jobId: jobs[0]?.id || '', amount: 0 }]);
  const removeAlloc = (i) => setAllocations(prev => prev.filter((_, idx) => idx !== i));

  const allocSum = allocations.reduce((s, a) => s + Number(a.amount || 0), 0);
  const allocOk = Math.abs(allocSum - expense.total) < 0.01;

  const save = () => {
    onUpdate(expense.id, { allocations: allocations.map(a => ({ jobId: a.jobId, amount: Number(a.amount) })), notes });
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.borderHi}`, maxWidth: 480, width: '100%' }}>
        <div style={{ padding: '14px 18px', borderBottom: `2px solid ${T.accent}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>RE-ALLOCATE</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18 }}>
          <div style={{ background: T.panel2, padding: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{expense.vendor}</div>
            <div style={{ fontSize: 13, color: T.textDim, marginTop: 2 }}>{expense.date} · Total <span style={{ color: T.accent, fontWeight: 700 }}>{fmtMoney(expense.total)}</span></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: T.accent, letterSpacing: 1, fontWeight: 700 }}>ALLOCATIONS</div>
            <button onClick={addAlloc} style={{ background: 'transparent', border: 'none', color: T.accent, fontSize: 13, cursor: 'pointer', fontWeight: 700, letterSpacing: 1 }}>+ SPLIT</button>
          </div>

          {allocations.map((alloc, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <select value={alloc.jobId} onChange={e => updateAlloc(i, 'jobId', e.target.value)} style={{ flex: 1, background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }}>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
              <input type="number" step="0.01" value={alloc.amount} onChange={e => updateAlloc(i, 'amount', Number(e.target.value))} style={{ width: 100, background: T.panel2, border: `1px solid ${T.border}`, color: T.green, padding: '8px 10px', fontSize: 14, fontWeight: 700, textAlign: 'right' }} />
              {allocations.length > 1 && <button onClick={() => removeAlloc(i)} style={{ background: 'transparent', border: 'none', color: T.red, cursor: 'pointer' }}><X size={14} /></button>}
            </div>
          ))}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 8, padding: '8px 10px', background: T.bg, marginBottom: 14 }}>
            <span style={{ color: T.textDim, letterSpacing: 1, fontWeight: 700 }}>ALLOCATED</span>
            <span style={{ color: allocOk ? T.green : T.red, fontWeight: 700 }}>
              {fmtMoney(allocSum)} / {fmtMoney(expense.total)}
            </span>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1, marginBottom: 4 }}>NOTES</div>
            <input value={notes} onChange={e => setNotes(e.target.value)} style={{ width: '100%', background: T.panel2, border: `1px solid ${T.border}`, color: T.text, padding: '8px 10px', fontSize: 14, fontFamily: 'inherit' }} />
          </div>

          <button onClick={save} disabled={!allocOk} style={{ width: '100%', background: allocOk ? T.green : T.panel2, color: allocOk ? '#000' : T.textMute, border: 'none', padding: '12px', fontWeight: 800, fontSize: 14, letterSpacing: 1, cursor: allocOk ? 'pointer' : 'not-allowed' }}>
            ✓ SAVE
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — PAYROLL (this week, what to pay each person)
// ============================================================
// ============================================================
// VIEW — COMPLETED JOBS DASHBOARD (P&L history + vendor tracking)
// ============================================================
function CompletedView({ jobs, expenses, timelog, team, role }) {
  const [period, setPeriod] = useState('week'); // day | week | month | quarter | year | all
  const [focusedJobId, setFocusedJobId] = useState(null);
  const [showVendors, setShowVendors] = useState(false);

  const today = parseDate('2026-04-29');
  const todayStr = '2026-04-29';

  // Helper: is a date string within the current period window?
  const inPeriod = (dateStr) => {
    if (!dateStr) return false;
    if (period === 'all') return true;
    const d = parseDate(dateStr);
    if (period === 'day') return dateStr === todayStr;
    if (period === 'week') {
      const ws = new Date(today); ws.setDate(today.getDate() - today.getDay());
      const we = new Date(ws); we.setDate(ws.getDate() + 6);
      return d >= ws && d <= we;
    }
    if (period === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    if (period === 'quarter') {
      const tq = Math.floor(today.getMonth() / 3);
      return Math.floor(d.getMonth() / 3) === tq && d.getFullYear() === today.getFullYear();
    }
    if (period === 'year') return d.getFullYear() === today.getFullYear();
    return true;
  };

  // Filter completed jobs by period
  const completedJobs = jobs.filter(j => j.status === 'complete' && j.completedDate);
  const periodJobs = completedJobs
    .filter(j => inPeriod(j.completedDate))
    .sort((a, b) => b.completedDate.localeCompare(a.completedDate));

  // Calculate per-job P&L
  const jobsWithPnl = periodJobs.map(j => {
    const jobExpenses = expenses.filter(e => e.allocations.some(a => a.jobId === j.id));
    const materialSpent = jobExpenses.reduce((s, e) => {
      const alloc = e.allocations.find(a => a.jobId === j.id);
      return s + (alloc?.amount || 0);
    }, 0);
    const laborSpent = j.actualLaborCost || 0;
    const totalCost = materialSpent + laborSpent;
    const profit = j.contractValue - totalCost;
    const margin = j.contractValue > 0 ? (profit / j.contractValue) * 100 : 0;
    return { ...j, materialSpent, laborSpent, totalCost, profit, margin, jobExpenses };
  });

  // Totals across the period
  const totalRevenue = jobsWithPnl.reduce((s, j) => s + j.contractValue, 0);
  const totalLabor = jobsWithPnl.reduce((s, j) => s + j.laborSpent, 0);
  const totalMaterial = jobsWithPnl.reduce((s, j) => s + j.materialSpent, 0);
  const totalCost = totalLabor + totalMaterial;
  const totalProfit = totalRevenue - totalCost;
  const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // ============== CASH POSITION CALCULATIONS ==============
  // Pulls draws from active jobs + expenses for this period
  const allDraws = jobs.flatMap(j => (j.draws || []).map(d => ({ ...d, jobId: j.id, jobName: j.name })));

  const drawsReceivedInPeriod = allDraws.filter(d => d.status === 'received' && inPeriod(d.date));
  const drawsRequestedInPeriod = allDraws.filter(d => d.status === 'requested' && inPeriod(d.date));
  const cashIn = drawsReceivedInPeriod.reduce((s, d) => s + d.amount, 0);
  const cashRequested = drawsRequestedInPeriod.reduce((s, d) => s + d.amount, 0);

  // Outstanding A/R: all pending + requested draws on active jobs
  const outstandingAR = allDraws
    .filter(d => (d.status === 'pending' || d.status === 'requested'))
    .filter(d => {
      const job = jobs.find(jj => jj.id === d.jobId);
      return job && job.status !== 'complete';
    })
    .reduce((s, d) => s + d.amount, 0);

  // Cash out vs credit owed for this period
  const periodExpenses = expenses.filter(e => inPeriod(e.date));
  const cashOut = periodExpenses
    .filter(e => e.paymentMethod === 'cod-cash' || e.paymentMethod === 'cod-card' || e.paymentMethod === 'check')
    .reduce((s, e) => s + e.total, 0);
  const creditOwed = periodExpenses
    .filter(e => e.paymentMethod === 'credit-account')
    .reduce((s, e) => s + e.total, 0);
  const netCash = cashIn - cashOut;

  // Draws coming up next 7 days (uses expectedDate if set, else falls back to pending draws on active jobs)
  const next7 = new Date(today); next7.setDate(today.getDate() + 7);
  const drawsComingUp = allDraws
    .filter(d => d.status === 'pending' && d.expectedDate)
    .filter(d => {
      const ex = parseDate(d.expectedDate);
      return ex >= today && ex <= next7;
    })
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

  // Drill-down focused job
  const focusedJob = focusedJobId ? jobsWithPnl.find(j => j.id === focusedJobId) : null;

  if (focusedJob) {
    return <CompletedJobDetail job={focusedJob} onBack={() => setFocusedJobId(null)} />;
  }

  if (showVendors) {
    return <VendorSummary expenses={expenses} jobs={jobs} period={period} onBack={() => setShowVendors(false)} />;
  }

  const periodLabels = {
    day: 'Today',
    week: 'This Week',
    month: 'This Month',
    quarter: 'This Quarter',
    year: 'This Year',
    all: 'All Time',
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Financials</div>
          <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>Cash flow · P&L · {periodLabels[period]}</div>
        </div>
        <button onClick={() => setShowVendors(true)} style={{ background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '8px 14px', fontWeight: 700, fontSize: 13, letterSpacing: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Receipt size={13} /> VENDOR SUMMARY
        </button>
      </div>

      {/* PERIOD TOGGLE — DAY · WEEK · MONTH · QUARTER · YEAR · ALL */}
      <div style={{ display: 'flex', gap: 4, background: T.panel2, padding: 3, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'day', label: 'DAY' },
          { id: 'week', label: 'WEEK' },
          { id: 'month', label: 'MONTH' },
          { id: 'quarter', label: 'QUARTER' },
          { id: 'year', label: 'YEAR' },
          { id: 'all', label: 'ALL TIME' },
        ].map(p => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            style={{
              flex: '1 1 80px',
              background: period === p.id ? T.accent : 'transparent',
              color: period === p.id ? '#000' : T.textDim,
              border: 'none', padding: '8px 6px',
              fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* CASH POSITION CARD — moved here from Dashboard */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${T.green}` }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.green, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Wallet size={11} /> CASH POSITION · {periodLabels[period].toUpperCase()}
        </div>

        {/* TOP ROW: Received / Requested / Outstanding A/R */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>RECEIVED</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.green }}>{fmtMoney(cashIn)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{drawsReceivedInPeriod.length} {drawsReceivedInPeriod.length === 1 ? 'draw' : 'draws'}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>REQUESTED</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.accent }}>{fmtMoney(cashRequested)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>awaiting payment</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>OUTSTANDING A/R</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{fmtMoney(outstandingAR)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>across all open jobs</div>
          </div>
        </div>

        {/* CASH FLOW THIS PERIOD */}
        <div style={{ background: T.bg, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.textDim, fontWeight: 700, marginBottom: 8 }}>CASH FLOW · {periodLabels[period].toUpperCase()}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>CASH IN</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.green }}>{fmtMoney(cashIn)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>CASH OUT</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.red }}>{fmtMoney(cashOut)}</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>cash + card + check</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>CREDIT OWED</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.purple }}>{fmtMoney(creditOwed)}</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>added to credit accts</div>
            </div>
            <div style={{ borderLeft: `1px solid ${T.border}`, paddingLeft: 10 }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>NET CASH</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: netCash > 0 ? T.green : netCash < 0 ? T.red : T.text }}>{fmtMoney(netCash)}</div>
              <div style={{ fontSize: 12, color: T.textDim, marginTop: 1 }}>in − out</div>
            </div>
          </div>
        </div>

        {/* DRAWS COMING UP NEXT 7 DAYS */}
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.textDim, fontWeight: 700, marginBottom: 8 }}>DRAWS COMING UP · NEXT 7 DAYS</div>
          {drawsComingUp.length === 0 ? (
            <div style={{ fontSize: 13, color: T.textMute, padding: '8px 0' }}>None scheduled this week</div>
          ) : drawsComingUp.map((d, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: T.bg, marginBottom: 4, borderLeft: `2px solid ${T.accent}` }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{d.jobName.split(' — ')[0]}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>
                  {d.name} · {parseDate(d.expectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.accent }}>{fmtMoney(d.amount)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* P&L SUMMARY */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${totalProfit > 0 ? T.green : T.red}` }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: totalProfit > 0 ? T.green : T.red, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          {totalProfit > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} P&L · {periodLabels[period].toUpperCase()}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>REVENUE</div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{fmtMoney(totalRevenue)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{jobsWithPnl.length} {jobsWithPnl.length === 1 ? 'job' : 'jobs'}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>LABOR COST</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.accent }}>{fmtMoney(totalLabor)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>MATERIAL COST</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.blue }}>{fmtMoney(totalMaterial)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>NET PROFIT</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: totalProfit > 0 ? T.green : T.red }}>{fmtMoney(totalProfit)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{avgMargin.toFixed(1)}% margin</div>
          </div>
        </div>
      </div>

      {/* JOBS LIST */}
      <div style={{ fontSize: 13, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10 }}>JOBS · NEWEST FIRST</div>

      {jobsWithPnl.length === 0 ? (
        <div style={{ background: T.panel, padding: 30, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
          No completed jobs in this period.
        </div>
      ) : jobsWithPnl.map(j => (
        <div
          key={j.id}
          onClick={() => setFocusedJobId(j.id)}
          style={{
            background: T.panel, padding: '12px 14px', marginBottom: 8,
            borderLeft: `4px solid ${j.profit > 0 ? T.green : T.red}`,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = T.panel2}
          onMouseLeave={e => e.currentTarget.style.background = T.panel}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{j.name}</div>
              <div style={{ fontSize: 13, color: T.textDim, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={11} /> {j.address}
                <span style={{ marginLeft: 6 }}>· Completed {parseDate(j.completedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: j.profit > 0 ? T.green : T.red }}>{fmtMoney(j.profit)}</div>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>{j.margin.toFixed(1)}% MARGIN</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 13, flexWrap: 'wrap' }}>
            <span style={{ color: T.textDim }}>CONTRACT <span style={{ color: T.text, fontWeight: 600 }}>{fmtMoney(j.contractValue)}</span></span>
            <span style={{ color: T.textDim }}>LABOR <span style={{ color: T.accent, fontWeight: 600 }}>{fmtMoney(j.laborSpent)}</span></span>
            <span style={{ color: T.textDim }}>MATERIAL <span style={{ color: T.blue, fontWeight: 600 }}>{fmtMoney(j.materialSpent)}</span></span>
            <span style={{ color: T.textDim }}>FOREMAN <span style={{ color: T.text, fontWeight: 600 }}>{j.foreman}</span></span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Drill-down: full P&L for one completed job
function CompletedJobDetail({ job, onBack }) {
  return (
    <div style={{ padding: 20 }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: T.textDim, fontSize: 13, cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 1 }}>
        <ChevronLeft size={14} /> COMPLETED JOBS
      </button>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{job.name}</div>
        <div style={{ fontSize: 14, color: T.textDim, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
          <MapPin size={12} /> {job.address}
          <span style={{ marginLeft: 8 }}>· {parseDate(job.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} → {parseDate(job.completedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      {/* P&L SUMMARY */}
      <div style={{ background: T.panel, padding: 16, marginBottom: 14, borderLeft: `3px solid ${job.profit > 0 ? T.green : T.red}` }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: job.profit > 0 ? T.green : T.red, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          {job.profit > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />} JOB P&L
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <div style={{ padding: 10, background: T.panel2 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>REVENUE</div>
            <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{fmtMoney(job.contractValue)}</div>
          </div>
          <div style={{ padding: 10, background: T.panel2 }}>
            <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>TOTAL COST</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.accent, marginTop: 2 }}>{fmtMoney(job.totalCost)}</div>
            <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>Labor {fmtMoney(job.laborSpent)} · Mat {fmtMoney(job.materialSpent)}</div>
          </div>
        </div>
        <div style={{ background: T.bg, padding: 12, borderLeft: `3px solid ${job.profit > 0 ? T.green : T.red}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 14, letterSpacing: 1, color: T.textDim, fontWeight: 700 }}>NET PROFIT</div>
            <div style={{ fontSize: 30, fontWeight: 800, color: job.profit > 0 ? T.green : T.red }}>
              {fmtMoney(job.profit)} <span style={{ fontSize: 15, color: T.textDim, fontWeight: 600 }}>{job.margin.toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* DRAWS RECEIVED */}
      {job.draws && job.draws.length > 0 && (
        <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wallet size={11} /> PAYMENTS RECEIVED
          </div>
          {job.draws.filter(d => d.status === 'received').map(d => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{d.date} · {d.method}</div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: T.green }}>{fmtMoney(d.amount)}</div>
            </div>
          ))}
        </div>
      )}

      {/* MATERIAL EXPENSES */}
      {job.jobExpenses.length > 0 && (
        <div style={{ background: T.panel, padding: 16, marginBottom: 14 }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Receipt size={11} /> MATERIAL EXPENSES
          </div>
          {job.jobExpenses.map(e => {
            const alloc = e.allocations.find(a => a.jobId === job.id);
            const pm = e.paymentMethod ? PAYMENT_METHOD[e.paymentMethod] : null;
            return (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${T.border}`, gap: 8 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {e.vendor}
                    {pm && (
                      <span style={{ background: pm.color, color: '#000', padding: '1px 5px', fontSize: 12, letterSpacing: 1, fontWeight: 800 }}>
                        {pm.short}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{e.date}</div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.blue, flexShrink: 0 }}>{fmtMoney(alloc?.amount || 0)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Vendor Summary — shows what's been spent per vendor with COD/Credit breakdown
function VendorSummary({ expenses, jobs, period, onBack }) {
  const today = parseDate('2026-04-29');

  // Filter by period
  const periodExpenses = expenses.filter(e => {
    if (period === 'all') return true;
    const d = parseDate(e.date);
    if (period === 'month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
    if (period === 'quarter') {
      const tq = Math.floor(today.getMonth() / 3);
      return Math.floor(d.getMonth() / 3) === tq && d.getFullYear() === today.getFullYear();
    }
    if (period === 'year') return d.getFullYear() === today.getFullYear();
    return true;
  });

  // Group by vendor
  const byVendor = {};
  periodExpenses.forEach(e => {
    if (!byVendor[e.vendor]) {
      byVendor[e.vendor] = { vendor: e.vendor, total: 0, byMethod: {}, count: 0, expenses: [] };
    }
    byVendor[e.vendor].total += e.total;
    byVendor[e.vendor].count += 1;
    byVendor[e.vendor].expenses.push(e);
    const method = e.paymentMethod || 'other';
    byVendor[e.vendor].byMethod[method] = (byVendor[e.vendor].byMethod[method] || 0) + e.total;
  });

  const vendors = Object.values(byVendor).sort((a, b) => b.total - a.total);
  const grandTotal = vendors.reduce((s, v) => s + v.total, 0);

  // Totals by payment method
  const methodTotals = {};
  periodExpenses.forEach(e => {
    const m = e.paymentMethod || 'other';
    methodTotals[m] = (methodTotals[m] || 0) + e.total;
  });

  const periodLabels = { month: 'This Month', quarter: 'This Quarter', year: 'This Year', all: 'All Time' };

  return (
    <div style={{ padding: 20 }}>
      <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: T.textDim, fontSize: 13, cursor: 'pointer', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 1 }}>
        <ChevronLeft size={14} /> BACK
      </button>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Vendor Summary</div>
        <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>{periodLabels[period]} · {fmtMoney(grandTotal)} total</div>
      </div>

      {/* PAYMENT METHOD BREAKDOWN */}
      <div style={{ background: T.panel, padding: 14, marginBottom: 14 }}>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10 }}>BY PAYMENT METHOD</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {Object.entries(PAYMENT_METHOD).filter(([k]) => methodTotals[k]).map(([k, v]) => {
            const amt = methodTotals[k] || 0;
            const pct = grandTotal > 0 ? (amt / grandTotal) * 100 : 0;
            return (
              <div key={k} style={{ background: T.panel2, padding: 10, borderLeft: `3px solid ${v.color}` }}>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>{v.label.toUpperCase()}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: v.color, marginTop: 2 }}>{fmtMoney(amt)}</div>
                <div style={{ fontSize: 12, color: T.textDim, marginTop: 2 }}>{pct.toFixed(0)}% of total</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* VENDOR LIST */}
      <div style={{ fontSize: 13, letterSpacing: 2, color: T.accent, fontWeight: 700, marginBottom: 10 }}>VENDORS · BY SPEND</div>

      {vendors.length === 0 ? (
        <div style={{ background: T.panel, padding: 30, textAlign: 'center', color: T.textDim, fontSize: 14 }}>
          No expenses in this period.
        </div>
      ) : vendors.map(v => (
        <div key={v.vendor} style={{ background: T.panel, padding: 14, marginBottom: 8, borderLeft: `3px solid ${T.accent}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{v.vendor}</div>
              <div style={{ fontSize: 13, color: T.textDim, marginTop: 3 }}>
                {v.count} {v.count === 1 ? 'transaction' : 'transactions'} · {((v.total / grandTotal) * 100).toFixed(0)}% of total spend
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.accent }}>{fmtMoney(v.total)}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            {Object.entries(v.byMethod).map(([k, amt]) => {
              const pm = PAYMENT_METHOD[k];
              if (!pm) return null;
              return (
                <span key={k} style={{ background: pm.color, color: '#000', padding: '3px 8px', fontSize: 12, fontWeight: 700, letterSpacing: 0.5 }}>
                  {pm.short} · {fmtMoney(amt)}
                </span>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PayrollView({ team, timelog, jobs, role }) {
  const [focusedMemberId, setFocusedMemberId] = useState(null);

  // For demo, treat all entries as "this week"
  // In real app this would filter by ISO week
  const weekEntries = timelog;

  const breakdown = team.map(member => {
    const myEntries = weekEntries.filter(e => e.worker === member.name);
    const totalHours = myEntries.reduce((s, e) => s + e.hours, 0);
    // Days = unique date count
    const totalDays = [...new Set(myEntries.map(e => e.date))].length;
    const flagged = myEntries.filter(e => !e.verified).length;

    let owed = 0;
    let breakdownLabel = '';
    if (member.payType === 'hourly') {
      owed = member.payAmount * totalHours;
      breakdownLabel = `${totalHours}h × $${member.payAmount}/hr`;
    } else if (member.payType === 'daily') {
      owed = member.payAmount * totalDays;
      breakdownLabel = `${totalDays} ${totalDays === 1 ? 'day' : 'days'} × $${member.payAmount}/day`;
    } else if (member.payType === 'salary') {
      owed = member.payAmount;
      breakdownLabel = `Weekly salary`;
    }

    // jobs they worked
    const jobIds = [...new Set(myEntries.map(e => e.jobId))];
    const jobNames = jobIds.map(id => jobs.find(j => j.id === id)?.name.split(' — ')[0]).filter(Boolean);

    return { member, totalHours, totalDays, flagged, owed, breakdownLabel, jobNames, entries: myEntries };
  });

  const totalPayroll = breakdown.reduce((s, b) => s + b.owed, 0);
  const totalFlagged = breakdown.reduce((s, b) => s + b.flagged, 0);
  const totalHoursAll = breakdown.reduce((s, b) => s + b.totalHours, 0);

  const focusedBreakdown = focusedMemberId ? breakdown.find(b => b.member.id === focusedMemberId) : null;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800 }}>Payroll This Week</div>
          <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>Apr 27 – May 3, 2026</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <StatCard label="TOTAL OWED" value={fmtMoney(totalPayroll)} accent={T.accent} />
        <StatCard label="TOTAL HOURS" value={`${totalHoursAll}h`} accent={T.blue} />
        <StatCard label="WORKERS" value={breakdown.filter(b => b.owed > 0).length} accent={T.green} />
        <StatCard label="FLAGGED" value={totalFlagged} accent={totalFlagged > 0 ? T.red : T.textMute} />
      </div>

      {breakdown.filter(b => b.owed > 0).map(b => (
        <div
          key={b.member.id}
          onClick={() => setFocusedMemberId(b.member.id)}
          style={{
            background: T.panel, marginBottom: 8, borderLeft: `4px solid ${b.member.color}`,
            cursor: 'pointer', transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = T.panel2}
          onMouseLeave={e => e.currentTarget.style.background = T.panel}
        >
          <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: b.member.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
                {b.member.initials}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{b.member.name}</div>
                <div style={{ fontSize: 13, color: T.textDim }}>{b.member.role}</div>
              </div>
            </div>
            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: T.green }}>{fmtMoney(b.owed)}</div>
                <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>{b.breakdownLabel}</div>
              </div>
              <ChevronRight size={18} style={{ color: T.textMute }} />
            </div>
          </div>
          <div style={{ padding: '8px 16px 14px', borderTop: `1px solid ${T.border}`, fontSize: 13, color: T.textDim, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>JOBS: <span style={{ color: T.text }}>{b.jobNames.join(', ') || '—'}</span></span>
            {b.flagged > 0 && <span style={{ color: T.red, fontWeight: 700 }}>⚠ {b.flagged} flagged entry — review before paying</span>}
          </div>
        </div>
      ))}

      <div style={{ background: T.panel2, borderLeft: `4px solid ${T.accent}`, padding: 14, marginTop: 20 }}>
        <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>WEEK TOTAL</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 14, color: T.textDim }}>{breakdown.filter(b => b.owed > 0).length} workers · {totalHoursAll} hours</div>
          <div style={{ fontSize: 30, fontWeight: 800, color: T.accent }}>{fmtMoney(totalPayroll)}</div>
        </div>
      </div>

      {focusedBreakdown && (
        <PayrollDetailPanel breakdown={focusedBreakdown} jobs={jobs} onClose={() => setFocusedMemberId(null)} />
      )}
    </div>
  );
}

// Drill-down panel: where this person worked, hours per job, hours per day
function PayrollDetailPanel({ breakdown, jobs, onClose }) {
  const { member, entries, owed, breakdownLabel, totalHours, totalDays, flagged } = breakdown;

  // Group by job
  const byJob = {};
  entries.forEach(e => {
    if (!byJob[e.jobId]) byJob[e.jobId] = { hours: 0, days: new Set(), entries: [] };
    byJob[e.jobId].hours += e.hours;
    byJob[e.jobId].days.add(e.date);
    byJob[e.jobId].entries.push(e);
  });

  // Group by day for the day-by-day view
  const byDay = {};
  entries.forEach(e => {
    if (!byDay[e.date]) byDay[e.date] = [];
    byDay[e.date].push(e);
  });

  // Sort days ascending
  const sortedDays = Object.keys(byDay).sort();

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', justifyContent: 'flex-end' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.panel, width: '100%', maxWidth: 540, height: '100vh', overflowY: 'auto', borderLeft: `2px solid ${member.color}` }}>
        {/* HEADER */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, background: T.panel, zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: member.color, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800 }}>
                {member.initials}
              </div>
              <div>
                <div style={{ fontSize: 19, fontWeight: 800 }}>{member.name}</div>
                <div style={{ fontSize: 13, color: T.textDim }}>{member.role}</div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: T.textDim, cursor: 'pointer' }}><X size={18} /></button>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          {/* AMOUNT OWED */}
          <div style={{ background: T.panel2, borderLeft: `3px solid ${T.green}`, padding: 14, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: T.green, letterSpacing: 2, fontWeight: 700, marginBottom: 4 }}>OWED THIS WEEK</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: T.green }}>{fmtMoney(owed)}</div>
              <div style={{ fontSize: 13, color: T.textDim }}>{breakdownLabel}</div>
            </div>
          </div>

          {/* TOTALS */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 18 }}>
            <div style={{ background: T.panel2, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>HOURS</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.accent, marginTop: 2 }}>{totalHours}h</div>
            </div>
            <div style={{ background: T.panel2, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>DAYS</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.blue, marginTop: 2 }}>{totalDays}</div>
            </div>
            <div style={{ background: T.panel2, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: T.textDim, letterSpacing: 1 }}>FLAGGED</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: flagged > 0 ? T.red : T.textMute, marginTop: 2 }}>{flagged}</div>
            </div>
          </div>

          {/* BY JOB */}
          <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 700, marginBottom: 8 }}>BREAKDOWN BY JOB</div>
          {Object.entries(byJob).length === 0 && (
            <div style={{ background: T.panel2, padding: 14, textAlign: 'center', color: T.textDim, fontSize: 14, marginBottom: 18 }}>No time logged yet.</div>
          )}
          {Object.entries(byJob).map(([jobId, data]) => {
            const job = jobs.find(j => j.id === jobId);
            const status = job ? STATUS_STYLE[job.status] : null;
            // Calculate the prorated pay for this job (correct for daily/salary multi-job days)
            const jobPay = data.entries.reduce((sum, entry) => {
              const allThatDay = entries.filter(e => e.date === entry.date);
              return sum + entryCostOnJob(member, entry, allThatDay);
            }, 0);
            return (
              <div key={jobId} style={{ background: T.panel2, padding: 12, marginBottom: 6, borderLeft: status ? `3px solid ${status.bg}` : `3px solid ${T.textMute}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{job?.name || 'Unknown job'}</div>
                    {job && (
                      <div style={{ fontSize: 12, color: T.textDim, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <MapPin size={10} /> {job.address}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.green }}>{fmtMoney(jobPay)}</div>
                    <div style={{ fontSize: 12, color: T.textDim }}>{data.hours}h · {data.days.size} {data.days.size === 1 ? 'day' : 'days'}</div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* DAY BY DAY */}
          <div style={{ fontSize: 12, color: T.accent, letterSpacing: 2, fontWeight: 700, marginTop: 18, marginBottom: 8 }}>DAY BY DAY</div>
          {sortedDays.length === 0 && (
            <div style={{ background: T.panel2, padding: 14, textAlign: 'center', color: T.textDim, fontSize: 14 }}>No entries.</div>
          )}
          {sortedDays.map(date => {
            const dayEntries = byDay[date];
            const dayHours = dayEntries.reduce((s, e) => s + e.hours, 0);
            const dateObj = parseDate(date);
            const uniqueJobsThatDay = new Set(dayEntries.map(e => e.jobId)).size;
            const isMultiJob = uniqueJobsThatDay > 1;
            // Day's pay total (correct for daily/salary)
            const dayPay = dayEntries.reduce((sum, entry) => sum + entryCostOnJob(member, entry, dayEntries), 0);
            return (
              <div key={date} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${T.border}`, marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    {isMultiJob && (
                      <span style={{ fontSize: 12, background: T.accent, color: '#000', padding: '1px 6px', letterSpacing: 1, fontWeight: 800 }}>
                        {uniqueJobsThatDay} JOBS
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 14, color: T.accent, fontWeight: 700 }}>{dayHours}h <span style={{ color: T.green, marginLeft: 6 }}>{fmtMoney(dayPay)}</span></div>
                </div>
                {dayEntries.map((e, i) => {
                  const job = jobs.find(j => j.id === e.jobId);
                  const entryPay = entryCostOnJob(member, e, dayEntries);
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', fontSize: 13, color: T.textDim, alignItems: 'center', gap: 6 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {job?.name.split(' — ')[0] || '—'} <span style={{ color: T.textMute, marginLeft: 4 }}>{e.clockIn || ''}{e.clockOut && ` – ${e.clockOut}`}</span>
                      </span>
                      <span style={{ color: T.text, fontWeight: 600 }}>{e.hours}h</span>
                      <span style={{ color: T.green, fontWeight: 600, fontSize: 12, minWidth: 50, textAlign: 'right' }}>{fmtMoney(entryPay)}</span>
                      {!e.verified && <ShieldAlert size={11} style={{ color: T.red }} />}
                      {e.adminEntry && <User size={11} style={{ color: T.accent }} />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// VIEW — CHAT
// ============================================================
function ChatView({ messages, jobs, role, onSend }) {
  const [text, setText] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all' ? messages : filter === 'general' ? messages.filter(m => !m.jobId) : messages.filter(m => m.jobId === filter);

  const send = () => {
    if (!text.trim()) return;
    onSend({
      id: 'm' + Date.now(),
      author: role.name,
      initials: role.name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2),
      text: text.trim(),
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      date: '2026-04-29',
      jobId: filter === 'all' || filter === 'general' ? null : filter,
    });
    setText('');
  };

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 110px)' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>Team Chat</div>
        <div style={{ fontSize: 14, color: T.textDim, marginTop: 2 }}>Filter by channel or job</div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ background: filter === 'all' ? T.accent : T.panel, color: filter === 'all' ? '#000' : T.textDim, border: `1px solid ${filter === 'all' ? T.accent : T.border}`, padding: '6px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>ALL</button>
        <button onClick={() => setFilter('general')} style={{ background: filter === 'general' ? T.accent : T.panel, color: filter === 'general' ? '#000' : T.textDim, border: `1px solid ${filter === 'general' ? T.accent : T.border}`, padding: '6px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>#GENERAL</button>
        {jobs.filter(j => j.status !== 'complete').map(j => (
          <button key={j.id} onClick={() => setFilter(j.id)} style={{ background: filter === j.id ? T.accent : T.panel, color: filter === j.id ? '#000' : T.textDim, border: `1px solid ${filter === j.id ? T.accent : T.border}`, padding: '6px 10px', fontSize: 12, fontWeight: 700, letterSpacing: 1, cursor: 'pointer' }}>
            #{j.name.split(' — ')[0].toUpperCase().replace(/\s+/g, '-')}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, background: T.panel, padding: 14, marginBottom: 12, overflowY: 'auto' }}>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', color: T.textDim, fontSize: 14, padding: 20 }}>No messages in this channel yet.</div>
        )}
        {filtered.map(m => {
          const job = jobs.find(j => j.id === m.jobId);
          return (
            <div key={m.id} style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: T.accent, color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
                {m.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{m.author}</span>
                  <span style={{ fontSize: 12, color: T.textDim }}>{m.time}</span>
                  {job && <span style={{ fontSize: 12, background: T.panel2, color: T.accent, padding: '1px 6px', letterSpacing: 1, fontWeight: 700 }}>#{job.name.split(' — ')[0].toUpperCase().replace(/\s+/g, '-')}</span>}
                </div>
                <div style={{ fontSize: 15, color: T.text, marginTop: 3, lineHeight: 1.5 }}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={filter === 'all' || filter === 'general' ? 'Message #general...' : `Message ${jobs.find(j => j.id === filter)?.name.split(' — ')[0]}...`}
          style={{ flex: 1, background: T.panel, border: `1px solid ${T.border}`, color: T.text, padding: '10px 12px', fontSize: 15, fontFamily: 'inherit' }}
        />
        <button onClick={send} style={{ background: T.accent, color: '#000', border: 'none', padding: '0 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 14 }}>
          <Send size={13} /> SEND
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================
export default function QuestApp() {
  const [role, setRole] = useState(null);
  const [view, setView] = useState('dash');
  const [focusedJobId, setFocusedJobId] = useState(null);
  const [jobs, setJobs] = useStoredState('quest-live-jobs', []);
  const [team, setTeam] = useStoredState('quest-live-team', []);
  const [timelog, setTimelog] = useStoredState('quest-live-timelog', []);
  const [messages, setMessages] = useStoredState('quest-live-messages', []);
  const [expenses, setExpenses] = useStoredState('quest-live-expenses', []);
  const [dataStatus, setDataStatus] = useState('loading');
  const [dataError, setDataError] = useState(null);
  const [showTimeClock, setShowTimeClock] = useState(false);
  const openEntry = role ? timelog.find(t => t.worker === role.name && !t.clockOut) : null;

  useEffect(() => {
    let cancelled = false;

    loadLiveData()
      .then((data) => {
        if (cancelled) return;
        setJobs(data.jobs || []);
        setTeam(data.team || []);
        setTimelog(data.timelog || []);
        setExpenses(data.expenses || []);
        setMessages(data.messages || []);
        setDataStatus('connected');
        setDataError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to load Supabase live data:', error);
        setDataError(error);
        setDataStatus(isMissingLiveTablesError(error) ? 'setup-needed' : 'cache-only');
      });

    return () => {
      cancelled = true;
    };
  }, [setExpenses, setJobs, setMessages, setTeam, setTimelog]);

  const reportSyncError = (error) => {
    console.error('Failed to sync live data:', error);
    setDataError(error);
    setDataStatus(isMissingLiveTablesError(error) ? 'setup-needed' : 'cache-only');
  };

  const syncSave = (collection, entity) => {
    upsertEntity(collection, entity)
      .then(() => {
        setDataStatus('connected');
        setDataError(null);
      })
      .catch(reportSyncError);
  };

  const syncDelete = (collection, id) => {
    deleteEntity(collection, id)
      .then(() => {
        setDataStatus('connected');
        setDataError(null);
      })
      .catch(reportSyncError);
  };

  // Add a brand new job
  const addJob = (jobData) => {
    const newJob = {
      id: 'j' + Date.now(),
      daysElapsed: 0,
      totalBurn: 0,
      crew: [],
      foreman: '',
      materials: [],
      draws: [],
      ...jobData,
    };
    setJobs(prev => [newJob, ...prev]);
    syncSave('jobs', newJob);
  };

  // Update an existing job
  const updateJob = (jobId, patch) => {
    const existingJob = jobs.find(j => j.id === jobId);
    const updatedJob = existingJob ? { ...existingJob, ...patch } : null;
    setJobs(prev => prev.map(j => j.id === jobId ? { ...j, ...patch } : j));
    if (updatedJob) syncSave('jobs', updatedJob);
  };

  const addMember = (member) => {
    setTeam(prev => [member, ...prev]);
    syncSave('team', member);
  };

  const handleClockIn = ({ worker, jobId, task, location, distance, verified, override, clockedInBy, adminEntry }) => {
    const time = fmtTime();
    const date = DEMO_TODAY; // demo date
    const workerName = worker || role.name;
    const workerMember = team.find(m => m.name === workerName);
    const newEntry = {
      id: 'tl' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      worker: workerName,
      jobId,
      task: task || 'General work',
      date,
      clockIn: time,
      clockOut: null,
      hours: 0,
      breaks: [],
      submitted: false,
      role: workerMember?.role || role.label,
      verified,
      distance,
      clockedInBy: clockedInBy || null,
      adminEntry: !!adminEntry,
      flagReason: !verified ? (override ? 'Manager override — outside geofence' : 'Outside geofence') : undefined,
    };
    setTimelog(prev => [...prev, newEntry]);
    syncSave('timelog', newEntry);
  };

  const handleClockOut = (entryId, location, distance) => {
    const time = fmtTime();
    const entry = timelog.find(t => t.id === entryId);
    if (!entry) return;
    const closedBreaks = (entry.breaks || []).map(b => b.end ? b : { ...b, end: time });
    const updatedEntry = {
      ...entry,
      clockOut: time,
      clockOutDistance: distance,
      clockOutVerified: distance === null || distance === undefined ? entry.verified : distance <= (jobs.find(j => j.id === entry.jobId)?.geofenceMiles || 1),
      breaks: closedBreaks,
      hours: payableHours(entry.clockIn, time, closedBreaks),
      submitted: true,
    };
    setTimelog(prev => prev.map(t => t.id === entryId ? updatedEntry : t));
    syncSave('timelog', updatedEntry);
  };

  const handleStartBreak = (entryId) => {
    const entry = timelog.find(t => t.id === entryId);
    if (!entry || entry.clockOut || (entry.breaks || []).some(b => !b.end)) return;
    const updatedEntry = { ...entry, breaks: [...(entry.breaks || []), { id: 'br' + Date.now(), start: fmtTime(), end: null }] };
    setTimelog(prev => prev.map(t => t.id === entryId ? updatedEntry : t));
    syncSave('timelog', updatedEntry);
  };

  const handleEndBreak = (entryId) => {
    const entry = timelog.find(t => t.id === entryId);
    if (!entry) return;
    const updatedEntry = { ...entry, breaks: (entry.breaks || []).map(b => b.end ? b : { ...b, end: fmtTime() }) };
    setTimelog(prev => prev.map(t => t.id === entryId ? updatedEntry : t));
    syncSave('timelog', updatedEntry);
  };

  const handleAddExpense = (exp) => {
    setExpenses(prev => [exp, ...prev]);
    syncSave('expenses', exp);
  };

  const handleUpdateExpense = (id, patch) => {
    const expense = expenses.find(e => e.id === id);
    const updatedExpense = expense ? { ...expense, ...patch } : null;
    setExpenses(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
    if (updatedExpense) syncSave('expenses', updatedExpense);
  };

  const handleDeleteExpense = (id) => {
    setExpenses(prev => prev.filter(e => e.id !== id));
    syncDelete('expenses', id);
  };

  const handleUpdateEntry = (id, patch) => {
    const entry = timelog.find(t => t.id === id);
    const updatedEntry = entry ? { ...entry, ...patch } : null;
    setTimelog(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    if (updatedEntry) syncSave('timelog', updatedEntry);
  };

  const handleDeleteEntry = (id) => {
    setTimelog(prev => prev.filter(t => t.id !== id));
    syncDelete('timelog', id);
  };

  const handleSendMessage = (message) => {
    setMessages(prev => [...prev, message]);
    syncSave('messages', message);
  };

  const gotoJob = (id) => {
    setFocusedJobId(id);
    setView('jobs');
  };

  if (!role) return <LoginScreen onPick={setRole} />;

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <TopBar role={role} openEntry={openEntry} onOpenTimeClock={() => setShowTimeClock(true)} onLogout={() => { setRole(null); setView('dash'); setFocusedJobId(null); }} view={view} setView={(v) => { setView(v); if (v !== 'jobs') setFocusedJobId(null); }} />
      <LiveDataStatus status={dataStatus} error={dataError} />
      {view === 'dash'      && <Dashboard jobs={jobs} role={role} gotoJob={gotoJob} setView={setView} team={team} timelog={timelog} expenses={expenses} />}
      {view === 'jobs'      && <JobsView jobs={jobs} role={role} focusedJobId={focusedJobId} setFocusedJobId={setFocusedJobId} expenses={expenses} timelog={timelog} team={team} onAddJob={addJob} />}
      {view === 'cal'       && <CalendarView jobs={jobs} gotoJob={gotoJob} />}
      {view === 'lookahead' && <LookAheadView jobs={jobs} gotoJob={gotoJob} />}
      {view === 'team'      && <TeamView team={team} jobs={jobs} role={role} timelog={timelog} onAddMember={addMember} />}
      {view === 'time'      && <TimeLogView timelog={timelog} jobs={jobs} team={team} role={role} onClockIn={handleClockIn} onClockOut={handleClockOut} onStartBreak={handleStartBreak} onEndBreak={handleEndBreak} onUpdateEntry={handleUpdateEntry} onDeleteEntry={handleDeleteEntry} onOpenTimeClock={() => setShowTimeClock(true)} />}
      {view === 'expenses'  && <ExpensesView expenses={expenses} jobs={jobs} role={role} onAdd={handleAddExpense} onUpdate={handleUpdateExpense} onDelete={handleDeleteExpense} />}
      {view === 'payroll'   && <PayrollView team={team} timelog={timelog} jobs={jobs} role={role} />}
      {view === 'completed' && <CompletedView jobs={jobs} expenses={expenses} timelog={timelog} team={team} role={role} />}
      {view === 'chat'      && <ChatView messages={messages} jobs={jobs} role={role} onSend={handleSendMessage} />}
      {showTimeClock && (
        <ClockInModal
          jobs={jobs}
          role={role}
          team={team}
          timelog={timelog}
          onClose={() => setShowTimeClock(false)}
          onClockIn={handleClockIn}
          openEntry={openEntry}
          onClockOut={handleClockOut}
        />
      )}
    </div>
  );
}
