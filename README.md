
# Configuração do Template - Sistema de Pagamentos com Mercado Pago e Supabase

Este guia te ajudará a configurar este template do zero para criar seu próprio sistema de pagamentos.

## 📋 Pré-requisitos

- Conta no [Supabase](https://supabase.com)
- Conta no [Mercado Pago](https://mercadopago.com.br)
- Node.js 18+ instalado
- Git instalado

## 🚀 Configuração Passo a Passo

### 1. Clonar o Template

```bash
# Use este template do GitHub ou clone diretamente
git clone <your-repo-url>
cd mercadopago-supabase-template
npm install
```

### 2. Configurar Supabase

#### 2.1 Criar Projeto Supabase
1. Acesse [supabase.com](https://supabase.com)
2. Clique em "New Project"
3. Escolha um nome e senha para seu projeto
4. Anote a **URL do projeto** e a **chave anon**

#### 2.2 Configurar Database
1. No painel do Supabase, vá em **SQL Editor**
2. Execute o SQL de migração completa (veja seção abaixo)
3. Verifique se as tabelas foram criadas: `plans`, `profiles`, `subscriptions`

#### 2.3 Configurar Autenticação
1. Vá em **Authentication > Settings**
2. Em **Site URL**, adicione: `http://localhost:5173` (desenvolvimento)
3. Em **Redirect URLs**, adicione:
   - `http://localhost:5173/**`
   - Sua URL de produção quando deploy

### 3. Configurar Mercado Pago

#### 3.1 Obter Credenciais de Teste
1. Acesse [developers.mercadopago.com](https://developers.mercadopago.com)
2. Vá em **Suas aplicações > Criar aplicação**
3. Configure sua aplicação e obtenha:
   - **Access Token de Teste**
   - **Public Key de Teste**

#### 3.2 Configurar Webhook (Importante!)
1. No painel do Mercado Pago, vá em **Webhooks**
2. Adicione a URL: `https://[SEU-PROJETO].supabase.co/functions/v1/mercadopago-webhook`
3. Selecione o evento: **Payments**

### 4. Configurar Variáveis de Ambiente

#### 4.1 Atualizar arquivo do projeto
Edite `src/integrations/supabase/client.ts`:
```typescript
const SUPABASE_URL = "SUA_URL_SUPABASE_AQUI";
const SUPABASE_PUBLISHABLE_KEY = "SUA_CHAVE_ANON_AQUI";
```

#### 4.2 Configurar Secrets do Supabase
No painel do Supabase, vá em **Edge Functions > Manage secrets** e adicione:

```
MERCADOPAGO_ACCESS_TOKEN=seu_access_token_de_teste
MERCADOPAGO_PUBLIC_KEY=sua_public_key_de_teste
SUPABASE_URL=sua_url_supabase
SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
```

### 5. Executar Migração SQL

Execute este SQL no **SQL Editor** do Supabase:

```sql
-- Criar tabela de perfis de usuários
CREATE TABLE public.profiles (
  id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email text,
  full_name text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Criar enum para tipos de planos
CREATE TYPE public.plan_type AS ENUM ('free', 'premium', 'vip');

-- Criar tabela de planos
CREATE TABLE public.plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  type plan_type NOT NULL UNIQUE,
  price decimal(10,2) NOT NULL,
  description text,
  features jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Criar tabela de assinaturas
CREATE TABLE public.subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.plans ON DELETE CASCADE,
  mercadopago_subscription_id text,
  status text DEFAULT 'pending',
  started_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Inserir planos padrão (PERSONALIZE AQUI!)
INSERT INTO public.plans (name, type, price, description, features) VALUES 
('Gratuito', 'free', 0.00, 'Plano básico gratuito', '["Acesso limitado", "Suporte básico"]'),
('Premium', 'premium', 29.90, 'Planos premium com recursos avançados', '["Acesso completo", "Suporte prioritário", "Recursos premium"]'),
('VIP', 'vip', 59.90, 'Plano VIP com todos os recursos', '["Acesso total", "Suporte 24/7", "Recursos exclusivos", "Sem limites"]');

-- Habilitar RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Políticas RLS para plans
CREATE POLICY "Everyone can view plans" ON public.plans
  FOR SELECT USING (true);

-- Políticas RLS para subscriptions
CREATE POLICY "Users can view own subscriptions" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own subscriptions" ON public.subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own subscriptions" ON public.subscriptions
  FOR UPDATE USING (auth.uid() = user_id);

-- Função para criar perfil automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger para novo usuário
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 6. Testar a Aplicação

```bash
npm run dev
```

#### 6.1 Testar Registro/Login
1. Acesse `http://localhost:5173`
2. Registre uma conta
3. Faça login

#### 6.2 Testar Pagamentos
1. Vá para `/plans`
2. Escolha um plano pago
3. Use os cartões de teste:
   - **Visa**: 4509 9535 6623 3704 (Nome: APRO)
   - **Mastercard**: 5031 7557 3453 0604 (Nome: APRO)

### 7. Deploy (Opcional)

#### 7.1 Deploy no Vercel/Netlify
```bash
npm run build
# Siga as instruções da sua plataforma de deploy
```

#### 7.2 Atualizar URLs
- Atualize as URLs de redirect no Supabase
- Atualize a URL do webhook no Mercado Pago

## 🎨 Personalização

### Modificar Planos
Edite os valores no SQL acima ou diretamente no banco:
```sql
UPDATE public.plans SET 
  name = 'Seu Plano',
  price = 99.90,
  description = 'Sua descrição',
  features = '["Recurso 1", "Recurso 2"]'
WHERE type = 'premium';
```

### Modificar Cores/Design
- Edite `src/index.css` para cores
- Modifique componentes em `src/components/`
- Personalize `src/pages/Plans.tsx`

## ❓ Problemas Comuns

### Erro de CORS
- Verifique se as URLs estão configuradas no Supabase

### Pagamentos não funcionam
- Confirme se o webhook está configurado
- Verifique se as credenciais estão corretas
- Use os cartões de teste oficiais

### Banco não conecta
- Verifique se a URL e chaves estão corretas
- Confirme se as migrations foram executadas

## 📞 Suporte

- Documentação Supabase: https://supabase.com/docs
- Documentação Mercado Pago: https://developers.mercadopago.com
- Issues do GitHub: [Criar issue]

---

**🎉 Pronto! Seu sistema de pagamentos está funcionando!**
