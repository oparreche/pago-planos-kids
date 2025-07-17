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
    console.log('=== WEBHOOK RECEIVED ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', Object.fromEntries(req.headers.entries()));
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const accessToken = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
    if (!accessToken) {
      console.error('Missing Mercado Pago access token');
      return new Response('Missing access token', {
        status: 500
      });
    }
    // Parse webhook data
    const body = await req.json();
    console.log('Webhook body:', JSON.stringify(body, null, 2));
    // Handle payment notifications
    if (body.type === 'payment') {
      const paymentId = body.data?.id;
      if (!paymentId) {
        console.log('No payment ID in webhook');
        return new Response('OK', {
          status: 200
        });
      }
      console.log('=== PROCESSING PAYMENT ===');
      console.log('Payment ID:', paymentId);
      // Get payment details from Mercado Pago
      console.log('Fetching payment details from Mercado Pago...');
      const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      if (!paymentResponse.ok) {
        console.error('Error fetching payment. Status:', paymentResponse.status);
        const errorText = await paymentResponse.text();
        console.error('Error response:', errorText);
        return new Response('Error fetching payment', {
          status: 500
        });
      }
      const payment = await paymentResponse.json();
      console.log('Payment details:', JSON.stringify(payment, null, 2));
      // Extract user and plan info from external_reference or metadata
      const externalRef = payment.external_reference;
      const metadata = payment.metadata;
      let userId;
      let planId;
      if (externalRef && externalRef.includes('_')) {
        [userId, planId] = externalRef.split('_');
        console.log('Extracted from external_reference - User ID:', userId, 'Plan ID:', planId);
      } else if (metadata) {
        userId = metadata.user_id;
        planId = metadata.plan_id;
        console.log('Extracted from metadata - User ID:', userId, 'Plan ID:', planId);
      } else {
        console.error('Unable to extract user/plan info from payment');
        console.error('External reference:', externalRef);
        console.error('Metadata:', metadata);
        return new Response('OK', {
          status: 200
        });
      }
      console.log('=== PAYMENT STATUS PROCESSING ===');
      console.log('Payment Status:', payment.status);
      console.log('Payment Status Detail:', payment.status_detail);
      console.log('User:', userId);
      console.log('Plan:', planId);
      // Update subscription based on payment status
      let subscriptionStatus = 'pending';
      let startedAt = null;
      let expiresAt = null;
      switch(payment.status){
        case 'approved':
          console.log('Payment approved - activating subscription');
          subscriptionStatus = 'active';
          startedAt = new Date().toISOString();
          // Set expiration to 30 days from now
          const expDate = new Date();
          expDate.setDate(expDate.getDate() + 30);
          expiresAt = expDate.toISOString();
          break;
        case 'rejected':
        case 'cancelled':
          console.log('Payment rejected/cancelled - cancelling subscription');
          subscriptionStatus = 'cancelled';
          break;
        case 'pending':
        case 'in_process':
          console.log('Payment pending/in_process - keeping pending status');
          subscriptionStatus = 'pending';
          break;
        case 'authorized':
          console.log('Payment authorized - keeping pending until captured');
          subscriptionStatus = 'pending';
          break;
        default:
          console.log('Unknown payment status:', payment.status);
          subscriptionStatus = 'pending';
      }
      console.log('Final subscription status:', subscriptionStatus);
      // First, try to find existing subscription
      console.log('Looking for existing subscription...');
      const { data: existingSubscriptions } = await supabaseClient.from('subscriptions').select('*').eq('user_id', userId).eq('plan_id', planId).in('status', [
        'pending',
        'active'
      ]);
      console.log('Found subscriptions:', existingSubscriptions?.length || 0);
      if (existingSubscriptions && existingSubscriptions.length > 0) {
        // Update existing subscription
        const subscription = existingSubscriptions[0];
        console.log('Updating existing subscription:', subscription.id);
        const { error: updateError } = await supabaseClient.from('subscriptions').update({
          status: subscriptionStatus,
          started_at: startedAt,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          mercadopago_subscription_id: payment.id.toString()
        }).eq('id', subscription.id);
        if (updateError) {
          console.error('Error updating subscription:', updateError);
        } else {
          console.log('Subscription updated successfully');
        }
      } else {
        // Create new subscription
        console.log('Creating new subscription...');
        const { error: createError } = await supabaseClient.from('subscriptions').insert({
          user_id: userId,
          plan_id: planId,
          status: subscriptionStatus,
          started_at: startedAt,
          expires_at: expiresAt,
          mercadopago_subscription_id: payment.id.toString()
        });
        if (createError) {
          console.error('Error creating subscription:', createError);
        } else {
          console.log('Subscription created successfully');
        }
      }
      console.log('=== WEBHOOK PROCESSING COMPLETE ===');
    } else {
      console.log('Non-payment webhook type:', body.type);
    }
    return new Response('OK', {
      status: 200
    });
  } catch (error) {
    console.error('=== WEBHOOK ERROR ===');
    console.error('Webhook error:', error);
    console.error('Error stack:', error.stack);
    return new Response('Error', {
      status: 500
    });
  }
});
