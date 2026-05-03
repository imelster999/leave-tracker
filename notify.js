import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_KEY
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN
const CHAT_ID        = process.env.CHAT_ID
const APP_URL        = process.env.APP_URL

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const MODE = process.argv[2] || 'daily'

const SG_PUBLIC_HOLIDAYS_2026 = {
  "2026-01-01": "New Year's Day",
  "2026-02-17": "Chinese New Year (Day 1)",
  "2026-02-18": "Chinese New Year (Day 2)",
  "2026-03-21": "Hari Raya Puasa",
  "2026-04-03": "Good Friday",
  "2026-05-01": "Labour Day",
  "2026-05-27": "Hari Raya Haji",
  "2026-05-31": "Vesak Day",
  "2026-08-09": "National Day",
  "2026-11-08": "Deepavali",
  "2026-12-25": "Christmas Day",
};
const SG_OIL_2026 = {
  "2026-06-01": "OIL — Vesak Day",
  "2026-08-10": "OIL — National Day",
  "2026-11-09": "OIL — Deepavali",
};

async function sendMessage(text) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' })
  })
}

async function dailyNotification() {
  const today = new Date().toISOString().split('T')[0]
  const dayName = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })

  const { data: leaves } = await supabase
    .from('leaves').select('*')
    .lte('start_date', today).gte('end_date', today)

  let message = `📅 *Leave Summary — ${dayName}*\n\n`

  if (SG_PUBLIC_HOLIDAYS_2026[today]) {
    message += `🎉 *Public Holiday: ${SG_PUBLIC_HOLIDAYS_2026[today]}*\n\n`
  }
  if (SG_OIL_2026[today]) {
    message += `📅 *${SG_OIL_2026[today]}* (substitute day)\n\n`
  }

  if (!leaves || leaves.length === 0) {
    message += `✅ Everyone is in today!\n`
  } else {
    message += `🏖 *Out today (${leaves.length}):*\n`
    leaves.forEach(l => { message += `• ${l.person} — ${l.type}\n` })
  }

  const nextWeekStart = new Date()
  nextWeekStart.setDate(nextWeekStart.getDate() + 1)
  const nextWeekEnd = new Date()
  nextWeekEnd.setDate(nextWeekEnd.getDate() + 7)

  const { data: upcoming } = await supabase
    .from('leaves').select('*')
    .gte('end_date', nextWeekStart.toISOString().split('T')[0])
    .lte('start_date', nextWeekEnd.toISOString().split('T')[0])
    .order('start_date')

  if (upcoming && upcoming.length > 0) {
    message += `\n📆 *Coming up (next 7 days):*\n`
    upcoming.forEach(l => {
      const start = new Date(l.start_date+'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' })
      const end   = new Date(l.end_date+'T00:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short' })
      const range = l.start_date === l.end_date ? start : `${start} – ${end}`
      message += `• ${l.person} (${range}) — ${l.type}\n`
    })
  }

  await sendMessage(message)
}

async function weeklyReminder() {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1))
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)

  const fmt = d => d.toLocaleDateString('en-GB', { day:'numeric', month:'short' })
  const monStr = monday.toISOString().split('T')[0]
  const friStr = friday.toISOString().split('T')[0]

  const { data: thisWeek } = await supabase
    .from('leaves').select('person')
    .lte('start_date', friStr).gte('end_date', monStr)

  const alreadyLogged = [...new Set((thisWeek || []).map(l => l.person))]

  let message = `📋 *Weekly Leave Check-in (${fmt(monday)} – ${fmt(friday)})*\n\n`
  message += `Please remember to log any planned leave days.\n\n`
  message += `🔗 [Open Leave Tracker](${APP_URL})\n\n`

  if (alreadyLogged.length > 0) {
    message += `✅ *Already logged this week:*\n`
    alreadyLogged.forEach(name => { message += `• ${name}\n` })
  }

  message += `\n_If nothing planned, no action needed._`
  await sendMessage(message)
}

async function mcReminder() {
  const today = new Date()
  const dow = today.getDay()
  if (dow === 0 || dow === 6) { console.log('Weekend — skipping'); return }

  const dayName = today.toLocaleDateString('en-GB', { weekday:'long' })
  const message =
    `🤒 *MC / Sick Leave Reminder*\n\n` +
    `Good morning! If you are on MC or unwell today (${dayName}), please update the tracker before *8:30am*.\n\n` +
    `🔗 [Open Leave Tracker](${APP_URL})\n\n` +
    `_Feel better soon if you're unwell!_ 🙏`

  await sendMessage(message)
}

if (MODE === 'weekly') weeklyReminder()
else if (MODE === 'mc') mcReminder()
else dailyNotification()
