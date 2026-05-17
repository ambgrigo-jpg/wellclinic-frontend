import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const setupSecret = Deno.env.get('ADMIN_SETUP_SECRET');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body
    const body = await req.json();
    const { email, password, displayName, setupToken, checkOnly } = body;

    // Handle check-only requests (to see if admin exists)
    if (checkOnly === true) {
      const { data: existingAdmins, error: checkError } = await supabase
        .from('user_roles')
        .select('id')
        .eq('role', 'admin')
        .limit(1);

      if (checkError) {
        console.error('Error checking admins:', checkError);
        return new Response(
          JSON.stringify({ success: false, error: 'Ошибка проверки' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          hasAdmin: existingAdmins && existingAdmins.length > 0 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate setup token for actual admin creation
    if (!setupSecret) {
      console.error('ADMIN_SETUP_SECRET not configured');
      return new Response(
        JSON.stringify({ success: false, error: 'Настройка безопасности не завершена' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!setupToken || typeof setupToken !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'Токен настройки обязателен' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Constant-time comparison to prevent timing attacks
    const tokenBytes = new TextEncoder().encode(setupToken);
    const secretBytes = new TextEncoder().encode(setupSecret);
    
    let tokenValid = tokenBytes.length === secretBytes.length;
    // Always iterate through all bytes to prevent timing attacks
    const maxLen = Math.max(tokenBytes.length, secretBytes.length);
    let diff = 0;
    for (let i = 0; i < maxLen; i++) {
      diff |= (tokenBytes[i] || 0) ^ (secretBytes[i] || 0);
    }
    tokenValid = tokenValid && diff === 0;

    if (!tokenValid) {
      console.warn('Invalid setup token attempt');
      return new Response(
        JSON.stringify({ success: false, error: 'Неверный токен настройки' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if any admin exists
    const { data: existingAdmins, error: checkError } = await supabase
      .from('user_roles')
      .select('id')
      .eq('role', 'admin')
      .limit(1);

    if (checkError) {
      console.error('Error checking admins:', checkError);
      return new Response(
        JSON.stringify({ success: false, error: 'Ошибка проверки' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (existingAdmins && existingAdmins.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Администратор уже существует', hasAdmin: true }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Некорректный email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 6) {
      return new Response(
        JSON.stringify({ success: false, error: 'Пароль должен быть минимум 6 символов' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (displayName && (typeof displayName !== 'string' || displayName.length > 100)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Некорректное имя' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create user with admin auth
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim(),
      password,
      email_confirm: true,
      user_metadata: {
        display_name: displayName?.trim() || null,
      },
    });

    if (authError || !authData.user) {
      console.error('Error creating user:', authError);
      return new Response(
        JSON.stringify({ success: false, error: authError?.message || 'Ошибка создания пользователя' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = authData.user.id;

    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        user_id: userId,
        display_name: displayName?.trim() || null,
      });

    if (profileError) {
      console.error('Error creating profile:', profileError);
      // Continue anyway - profile is not critical
    }

    // Assign admin role
    const { error: roleError } = await supabase
      .from('user_roles')
      .insert({
        user_id: userId,
        role: 'admin',
      });

    if (roleError) {
      console.error('Error assigning role:', roleError);
      // Delete the user if role assignment failed
      await supabase.auth.admin.deleteUser(userId);
      return new Response(
        JSON.stringify({ success: false, error: 'Ошибка назначения роли' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`First admin created successfully: ${email}`);

    return new Response(
      JSON.stringify({ success: true, userId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in create-first-admin:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Ошибка сервера' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
