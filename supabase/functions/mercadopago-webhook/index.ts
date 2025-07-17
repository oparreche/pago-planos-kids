import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({
        error: 'Não autorizado'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { planId } = await req.json();
    console.log('=== PAYMENT CREATION START ===');
    console.log('User ID:', user.id);
    console.log('Plan ID:', planId);
    console.log('User Email:', user.email);
    // Get plan details
    const { data: plan, error: planError } = await supabaseClient.from('plans').select('*').eq('id', planId).single();
    if (planError || !plan) {
      console.error('Plan error:', planError);
      return new Response(JSON.stringify({
        error: 'Plano não encontrado'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Plan details:', plan);
    // If it's a free plan, just create the subscription locally
    if (plan.type === 'free') {
      console.log('Creating free subscription...');
      const { data: subscription, error: subError } = await supabaseClient.from('subscriptions').insert({
        user_id: user.id,
        plan_id: planId,
        status: 'active',
        started_at: new Date().toISOString()
      }).select().single();
      if (subError) {
        console.error('Free subscription error:', subError);
        return new Response(JSON.stringify({
          error: 'Erro ao criar assinatura'
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      console.log('Free subscription created successfully:', subscription.id);
      return new Response(JSON.stringify({
        success: true,
        subscription
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // For paid plans, create Mercado Pago subscription
    const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      console.error('Missing Mercado Pago access token');
      return new Response(JSON.stringify({
        error: 'Configuração de pagamento não encontrada'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Creating Mercado Pago preference...');
    console.log('Access token configured:', !!accessToken);
    // Create preference for Mercado Pago
    const preference = {
      items: [
        {
          title: plan.name,
          description: plan.description,
          unit_price: plan.price,
          quantity: 1
        }
      ],
      payer: {
        email: user.email
      },
      back_urls: {
        success: `${req.headers.get('origin')}/dashboard?payment=success`,
        failure: `${req.headers.get('origin')}/dashboard?payment=failure`,
        pending: `${req.headers.get('origin')}/dashboard?payment=pending`
      },
      auto_return: "approved",
      external_reference: `${user.id}_${planId}`,
      metadata: {
        user_id: user.id,
        plan_id: planId,
        plan_name: plan.name,
        plan_price: plan.price,
        user_email: user.email
      },
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mercadopago-webhook`
    };
    console.log('MP preference payload:', JSON.stringify(preference, null, 2));
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(preference)
    });
    const mpData = await mpResponse.json();
    console.log('MP response status:', mpResponse.status);
    console.log('MP response data:', JSON.stringify(mpData, null, 2));
    if (!mpResponse.ok) {
      console.error('Mercado Pago error:', mpData);
      return new Response(JSON.stringify({
        error: 'Erro ao criar pagamento',
        details: mpData,
        debug: {
          status: mpResponse.status,
          preference: preference
        }
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Create pending subscription
    console.log('Creating pending subscription in database...');
    const { data: subscription, error: subError } = await supabaseClient.from('subscriptions').insert({
      user_id: user.id,
      plan_id: planId,
      status: 'pending',
      mercadopago_subscription_id: mpData.id
    }).select().single();
    if (subError) {
      console.error('Subscription creation error:', subError);
      return new Response(JSON.stringify({
        error: 'Erro ao criar assinatura'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Subscription created successfully:', subscription.id);
    console.log('Redirecting to Mercado Pago:', mpData.init_point);
    console.log('=== PAYMENT CREATION END ===');
    return new Response(JSON.stringify({
      success: true,
      init_point: mpData.init_point,
      subscription_id: subscription.id,
      preference_id: mpData.id,
      debug: {
        plan_type: plan.type,
        plan_price: plan.price,
        external_reference: preference.external_reference
      }
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('=== PAYMENT CREATION ERROR ===');
    console.error('Function error:', error);
    console.error('Error stack:', error.stack);
    return new Response(JSON.stringify({
      error: 'Erro interno do servidor',
      debug: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
