import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadRequest {
  name: string;
  phone: string;
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
  // Handle CORS preflight requests
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

    const { name, phone, service, doctor }: LeadRequest = await req.json();

    // Validate input - name required and reasonable length
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

    // Validate phone required and format
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

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    console.log('Telegram config check:', {
      hasBotToken: !!botToken,
      botTokenLength: botToken?.length,
      botTokenPrefix: botToken?.substring(0, 10),
      hasChatId: !!chatId,
      chatId: chatId
    });

    if (!botToken || !chatId) {
      console.error('Missing Telegram credentials');
      return new Response(
        JSON.stringify({ success: false, error: 'Telegram не настроен' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const now = new Date();
    const dateStr = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    
    const doctorName = doctor || null;
    
    
    
    const message = `
🦷 <b>Новая заявка с сайта!</b>

👤 <b>Имя:</b> ${escapeHtml(name.trim())}
📞 <b>Телефон:</b> ${escapeHtml(phone)}
${doctorName ? `👨‍⚕️ <b>Врач:</b> ${escapeHtml(doctorName)}` : ''}
${service ? `💊 <b>Услуга:</b> ${escapeHtml(service.trim())}` : ''}

📅 <b>Время:</b> ${dateStr}
    `.trim();

    // Send to Telegram
    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const telegramResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    const telegramResult = await telegramResponse.json();

    if (!telegramResponse.ok) {
      const description = (telegramResult && typeof telegramResult === 'object')
        ? (telegramResult.description || telegramResult.error || null)
        : null;

      console.error('Telegram API error:', telegramResult);
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ошибка отправки в Telegram',
          details: description,
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Lead sent to Telegram successfully from IP: ${clientIP}`);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-lead function:', error);
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
