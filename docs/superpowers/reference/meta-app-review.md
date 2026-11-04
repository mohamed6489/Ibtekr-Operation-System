# Meta App Review — Ibtekr Operation System (Tech Provider, WhatsApp coexistence)

Why (decision 26, 4 Nov): Embedded Signup does not offer «Connect your existing WhatsApp Business app» to our app yet — even
Meta's own launcher (Embedded Signup Builder, Feature Type `whatsapp_business_app_onboarding`) shows only «create a new number /
virtual number». The option opens to apps that finished **Tech Provider onboarding** (Business verification ✓ + App Review).

## 0. Before submitting (App settings → Basic)
- App icon 1024×1024, category «Business and pages».
- Privacy Policy URL and Terms URL on ibtekr.club (public pages).
- User data deletion: instructions URL (a page that says how to ask for deletion — e-mail / WhatsApp).
- App Roles: the reviewer needs nothing extra — the screencast shows everything.

## 1. Permissions to request (App Review → Permissions and features → Advanced Access)
WhatsApp (required for the Tech Provider step):
- `whatsapp_business_management`
- `whatsapp_business_messaging`

Messenger / Instagram (optional now — needed anyway when the app goes Live with the site switch; one submission saves a round):
- `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_show_list`, `business_management`
- `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`

## 2. Descriptions (paste per permission)

**whatsapp_business_management**
> Ibtekr Operation System is the internal customer-service tool of Ibtekr (ibtekr.club), an Egyptian marketplace for handmade
> products. Our admin connects Ibtekr's own WhatsApp Business account through Embedded Signup from the «Channels» screen. We use
> this permission to read the WhatsApp Business Account and its phone number (id, display number, whether it is on the WhatsApp
> Business app), to subscribe our app to the account's webhooks, and to request the one-time sync of the WhatsApp Business app's
> contacts and chat history (coexistence), so our customer-service team sees every conversation in one inbox. We do not manage
> accounts of other businesses.

**whatsapp_business_messaging**
> Customers message Ibtekr on WhatsApp about their orders. The messages arrive in our inbox through the messages webhook, together
> with the replies our team sends from the WhatsApp Business app on the phone (smb_message_echoes). An agent answers from the
> inbox; we send the reply with the Cloud API (POST /{phone-number-id}/messages) from the same number, only inside the 24-hour
> customer-service window, and show its delivery / read status. Messages are stored in our own database (Supabase, EU) for
> customer-service history only; no message content is shared with third parties.

**pages_messaging / instagram_manage_messages** (if included)
> Customers send private messages to the Ibtekr Club Facebook Page and Instagram account. Our inbox receives them via webhooks
> and our agents reply from the same screen with the Send API (RESPONSE, within 24 hours). One inbox for WhatsApp, Messenger and
> Instagram is the purpose of the tool.

**pages_read_user_content / pages_read_engagement / pages_manage_engagement / instagram_manage_comments** (if included)
> Comments on our own Page and Instagram posts appear in the inbox as conversations (one per post and commenter) with the post
> shown above them. Agents reply publicly, send a private reply, or hide an abusive comment.

**pages_manage_metadata / pages_show_list / business_management / instagram_basic** (if included)
> The admin picks the Ibtekr Club Page (owned by our Business Portfolio) when linking; we subscribe the app to the Page's webhooks
> and read the connected Instagram account's id and username.

## 3. Screencast (one video per platform, 2–4 minutes, English captions — the interface is Arabic)
WhatsApp (record with a spare SIM that is not on WhatsApp — the normal «create a new number» path works today; the main number is
linked by coexistence after approval):
1. Sign in to https://operation-system.ibtekr.club as the admin.
2. خدمة العملاء (Customer service) → القنوات (Channels) → WhatsApp 1 → ربط (Connect) → «ابدأ الربط» (Start) → Meta's Embedded
   Signup: business portfolio → new number → verify by SMS → finish. Caption: «Admin connects Ibtekr's WhatsApp Business account».
3. The card shows «متصلة» (Connected) with the number.
4. From a second phone, send «Hello, where is my order?» to the number → it appears in الرسايل (Inbox).
5. Type a reply in the inbox and send → show it arriving on the second phone, then the read tick in the inbox.
Caption every step in English.

Messenger / Instagram (if included): the same — connect the Page, a DM from a tester arrives, reply from the inbox; a comment on
a post appears with the post card, public reply / private reply / hide.

## 4. After approval
- Tech Provider onboarding → finish (Access verification if Meta asks).
- In the system: Channels → WhatsApp 1 → فصل (Disconnect) the spare number → ربط → «Connect your existing WhatsApp Business app» →
  the main number → confirm on the phone, accept sharing the chat history (within 24 hours the system asks for the last 6 months).
