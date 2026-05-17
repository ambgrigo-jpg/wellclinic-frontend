import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AppointmentEmailRequest {
  name: string;
  phone: string;
  date: string;
  time: string;
  service?: string;
  doctor?: string;
}

// Valid doctor names (full names are passed from frontend)
const validDoctorNames = [
  "Парсадаян Карине Альбертовна",
  "Амбарчян Степан Григорьевич",
  "Малахова Юлия Владимировна",
  "Погосян Роланд Робертович",
];

// Rate limiting: max requests per IP in time window
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  return 'unknown';
}

function checkRateLimit(clientIP: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const record = rateLimitMap.get(clientIP);
  
  // Clean up expired entries
  if (record && now > record.resetTime) {
    rateLimitMap.delete(clientIP);
  }
  
  const currentRecord = rateLimitMap.get(clientIP);
  
  if (!currentRecord) {
    rateLimitMap.set(clientIP, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  
  if (currentRecord.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((currentRecord.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  currentRecord.count++;
  return { allowed: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting check
    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);
    
    if (!rateCheck.allowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIP}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Слишком много запросов. Попробуйте позже.' }),
        { 
          status: 429, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'Retry-After': String(rateCheck.retryAfter || 60)
          } 
        }
      );
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const clinicEmail = Deno.env.get('CLINIC_EMAIL');

    if (!resendApiKey) {
      console.error('Missing RESEND_API_KEY');
      return new Response(
        JSON.stringify({ success: false, error: 'Email не настроен' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!clinicEmail) {
      console.error('Missing CLINIC_EMAIL');
      return new Response(
        JSON.stringify({ success: false, error: 'Email клиники не настроен' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { name, phone, date, time, service, doctor }: AppointmentEmailRequest = await req.json();

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Имя обязательно' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (name.length > 100) {
      return new Response(
        JSON.stringify({ success: false, error: 'Имя слишком длинное' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!phone || typeof phone !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Телефон обязателен' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const phoneClean = phone.replace(/\D/g, '');
    if (phoneClean.length < 10 || phoneClean.length > 15) {
      return new Response(
        JSON.stringify({ success: false, error: 'Некорректный номер телефона' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!date || typeof date !== 'string' || date.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Дата обязательна' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!time || typeof time !== 'string' || time.trim().length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Время обязательно' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate optional fields
    if (service && (typeof service !== 'string' || service.length > 200)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Некорректная услуга' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (doctor && (typeof doctor !== 'string' || doctor.length > 100)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Некорректный врач' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const resend = new Resend(resendApiKey);
    const doctorName = doctor || null;
    
    const now = new Date();
    const dateStr = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #2563eb, #1d4ed8); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
          .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }
          .field { margin-bottom: 15px; padding: 10px; background: white; border-radius: 8px; border-left: 4px solid #2563eb; }
          .label { font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase; }
          .value { font-size: 16px; color: #1e293b; margin-top: 4px; }
          .highlight { background: #dbeafe; padding: 15px; border-radius: 8px; text-align: center; margin: 15px 0; }
          .footer { text-align: center; padding: 15px; color: #64748b; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 style="margin: 0;">🦷 Новая запись на приём</h1>
          </div>
          <div class="content">
            <div class="highlight">
              <strong style="font-size: 18px;">📅 ${escapeHtml(date)} в ${escapeHtml(time)}</strong>
            </div>
            
            <div class="field">
              <div class="label">👤 Пациент</div>
              <div class="value">${escapeHtml(name.trim())}</div>
            </div>
            
            <div class="field">
              <div class="label">📞 Телефон</div>
              <div class="value">${escapeHtml(phone)}</div>
            </div>
            
            ${doctorName ? `
            <div class="field">
              <div class="label">👨‍⚕️ Врач</div>
              <div class="value">${escapeHtml(doctorName)}</div>
            </div>
            ` : ''}
            
            ${service ? `
            <div class="field">
              <div class="label">💊 Услуга</div>
              <div class="value">${escapeHtml(service.trim())}</div>
            </div>
            ` : ''}
            
            <div class="footer">
              Заявка получена: ${dateStr}
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailResponse = await resend.emails.send({
      from: 'Стоматология <onboarding@resend.dev>',
      to: [clinicEmail],
      subject: `🦷 Новая запись: ${escapeHtml(name.trim())} на ${escapeHtml(date)} в ${escapeHtml(time)}`,
      html: emailHtml,
    });

    console.log(`Email sent successfully from IP: ${clientIP}`, emailResponse);

    // Send Telegram notification
    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const telegramChatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (telegramBotToken && telegramChatId) {
      try {
        const telegramMessage = `🦷 *Новая запись на приём*

📅 *Дата:* ${escapeMarkdown(date)}
🕐 *Время:* ${escapeMarkdown(time)}

👤 *Пациент:* ${escapeMarkdown(name.trim())}
📞 *Телефон:* ${escapeMarkdown(phone)}
${doctorName ? `👨‍⚕️ *Врач:* ${escapeMarkdown(doctorName)}` : ''}
${service ? `💊 *Услуга:* ${escapeMarkdown(service.trim())}` : ''}

_Заявка получена: ${escapeMarkdown(dateStr)}_`;

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: telegramChatId,
              text: telegramMessage,
              parse_mode: 'Markdown',
            }),
          }
        );

        if (telegramResponse.ok) {
          console.log('Telegram notification sent successfully');
        } else {
          const telegramError = await telegramResponse.text();
          console.error('Telegram notification failed:', telegramError);
        }
      } catch (telegramError) {
        console.error('Error sending Telegram notification:', telegramError);
        // Don't fail the request if Telegram fails
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error sending email:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Ошибка сервера' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
}
