// Genera e invia via email il riepilogo settimanale HACCP di Baldoria.
// Eseguito automaticamente ogni lunedì mattina da GitHub Actions.

const SUPABASE_URL = "https://eoxainopyovzeytngyce.supabase.co";
const SUPABASE_KEY = "sb_publishable_PmcLucG1cpSukhiU4dd66Q_sSA-2p4g";
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEST_EMAIL = "baldoriaristopark@gmail.com";

async function sbGet(key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/haccp_kv?key=eq.${encodeURIComponent(key)}&select=value`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  if (!r.ok) throw new Error(`Errore lettura ${key}: ${r.status}`);
  const rows = await r.json();
  return rows.length ? JSON.parse(rows[0].value) : null;
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function fmtDateIt(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function buildReport() {
  const desde = isoDaysAgo(7);
  const oggi = isoDaysAgo(0);

  const [config, temperature, sanificazione, moma, noco, produzione, composizioni] = await Promise.all([
    sbGet("config"), sbGet("log-temperature"), sbGet("log-sanificazione"),
    sbGet("log-moma"), sbGet("log-noco"), sbGet("log-produzione"), sbGet("log-composizioni")
  ]);

  const inSettimana = (r) => r.data >= desde && r.data <= oggi;

  const tempSettimana = (temperature || []).filter(inSettimana);
  const tempFuoriSoglia = tempSettimana.filter(r => !r.conforme);

  const sanifSettimana = (sanificazione || []).filter(inSettimana);

  const momaSettimana = (moma || []).filter(inSettimana);

  const nocoSettimana = (noco || []).filter(n => (n.data || "") >= desde);
  const nocoAperte = (noco || []).filter(n => n.stato === "aperta");

  const composizioniSettimana = (composizioni || []).filter(inSettimana);

  const prodottiAttivi = (produzione || []).filter(p => !p.esaurito);
  const prodottiScaduti = prodottiAttivi.filter(p => p.dataScadenza < oggi);
  const prodottiInScadenza = prodottiAttivi.filter(p => {
    const diff = (new Date(p.dataScadenza) - new Date(oggi)) / 86400000;
    return diff >= 0 && diff <= 1;
  });

  const puntiConfigurati = (config && config.points || []).length;
  const puntiConNessunaLettura = (config && config.points || []).filter(
    p => !tempSettimana.some(r => r.pointId === p.id)
  );

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#3A3226;">
    <div style="background:#1F6F4A;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;">
      <h1 style="margin:0;font-size:20px;">🔥 Baldoria — Riepilogo settimanale HACCP</h1>
      <p style="margin:6px 0 0;opacity:.85;font-size:13px;">${fmtDateIt(desde)} – ${fmtDateIt(oggi)}</p>
    </div>
    <div style="border:1px solid #eee;border-top:none;padding:20px 24px;border-radius:0 0 10px 10px;">

      <h2 style="font-size:15px;border-bottom:2px solid #1F6F4A;padding-bottom:6px;">🌡️ Temperature</h2>
      <p style="font-size:14px;">
        <b>${tempSettimana.length}</b> letture registrate nella settimana.
        ${tempFuoriSoglia.length ? `<br><span style="color:#c0392b;">⚠️ ${tempFuoriSoglia.length} fuori soglia</span> — controlla i dettagli in app.` : "✅ Nessun valore fuori soglia."}
        ${puntiConNessunaLettura.length ? `<br>⚠️ Punti senza nessuna lettura questa settimana: ${puntiConNessunaLettura.map(p=>p.name).join(", ")}` : ""}
      </p>

      <h2 style="font-size:15px;border-bottom:2px solid #1F6F4A;padding-bottom:6px;">🧽 Sanificazione</h2>
      <p style="font-size:14px;"><b>${sanifSettimana.length}</b> sanificazioni confermate nella settimana (giornaliera + settimanale + mensile).</p>

      <h2 style="font-size:15px;border-bottom:2px solid #1F6F4A;padding-bottom:6px;">🚚 Consegne (MOMA)</h2>
      <p style="font-size:14px;"><b>${momaSettimana.length}</b> consegne registrate nella settimana.</p>

      <h2 style="font-size:15px;border-bottom:2px solid #1F6F4A;padding-bottom:6px;">⚠️ Non conformità</h2>
      <p style="font-size:14px;">
        <b>${nocoSettimana.length}</b> nuove segnalazioni questa settimana.
        ${nocoAperte.length ? `<br><span style="color:#c0392b;">🚨 ${nocoAperte.length} ancora aperte</span> — da chiudere appena possibile.` : "✅ Nessuna non conformità aperta al momento."}
      </p>

      <h2 style="font-size:15px;border-bottom:2px solid #1F6F4A;padding-bottom:6px;">🍽️ Produzione / Ricette</h2>
      <p style="font-size:14px;">
        <b>${composizioniSettimana.length}</b> preparazioni registrate questa settimana.<br>
        ${prodottiScaduti.length ? `<span style="color:#c0392b;">🚨 ${prodottiScaduti.length} prodotti risultano scaduti</span> e ancora segnati come attivi.<br>` : ""}
        ${prodottiInScadenza.length ? `⏳ ${prodottiInScadenza.length} prodotti in scadenza oggi/domani.` : "Nessun prodotto in scadenza imminente."}
      </p>

      <p style="font-size:12px;color:#8a8272;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
        Report generato automaticamente ogni lunedì dall'app HACCP Baldoria. Per i dettagli completi, apri l'app.
      </p>
    </div>
  </div>`;

  return html;
}

async function sendEmail(html) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Baldoria HACCP <onboarding@resend.dev>",
      to: [DEST_EMAIL],
      subject: `🔥 Baldoria — Riepilogo settimanale HACCP (${fmtDateIt(isoDaysAgo(7))} – ${fmtDateIt(isoDaysAgo(0))})`,
      html
    })
  });
  const data = await r.json();
  if (!r.ok) {
    console.error("Errore invio email:", JSON.stringify(data));
    process.exit(1);
  }
  console.log("Email inviata con successo:", data.id);
}

module.exports = { buildReport, sendEmail };

if (require.main === module) {
  (async () => {
    try {
      const html = await buildReport();
      await sendEmail(html);
    } catch (err) {
      console.error("Errore nella generazione/invio del report:", err);
      process.exit(1);
    }
  })();
}
