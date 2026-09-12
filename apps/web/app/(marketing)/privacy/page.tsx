import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/LegalPage';
import { fallbackConfig, getPublicConfig } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description:
    'What data Fundxtra holds about you, why we hold it, who can see it, and how to have it removed.',
  alternates: { canonical: '/privacy' },
};

export default async function PrivacyPage() {
  const site = (await getPublicConfig()) ?? fallbackConfig();

  return (
    <LegalPage
      title="Privacy policy"
      updated="12 September 2026"
      intro="This explains exactly what Fundxtra stores about you and why. We collect little, because the platform is built so that it does not need much."
      contact={{ handle: site.brand.supportHandle, url: site.brand.supportUrl }}
      sections={[
        {
          heading: 'What we collect',
          paragraphs: [
            'When you open Fundxtra, Telegram provides us with a signed set of details about your account. We verify that signature on our server and then store:',
          ],
          bullets: [
            'Your Telegram numeric ID, which is how we identify your account.',
            'Your Telegram first name, last name and username, and your profile photo URL, so the app can address you properly. These refresh each time you sign in.',
            'Your language code, so we can localise in future.',
            'A hash of your 4-digit PIN. Never the PIN itself.',
          ],
        },
        {
          heading: 'What we collect as you use Fundxtra',
          bullets: [
            'Which tasks you completed, when, and how they were verified.',
            'Screenshots you upload as proof, retained so a reviewer can check them and so a decision can be revisited if you query it.',
            'Every movement of your balance: rewards, referrals, withdrawals, redemptions and refunds.',
            'Your bank details when you request a cash withdrawal, so the payout can be made.',
            'Security events such as failed PIN attempts, so we can protect your account and detect abuse.',
            'Your IP address and browser user agent on requests, used for rate limiting and abuse prevention.',
          ],
        },
        {
          heading: 'What we do not collect',
          bullets: [
            'We do not ask for an email address or a password. There is nothing of that kind to leak.',
            'We do not read your Telegram messages, contacts or chats. Telegram does not give us access to them and we do not request it.',
            'We do not store your PIN in a form anyone can read, including us.',
            'We do not use advertising trackers or sell your data to anyone.',
          ],
        },
        {
          heading: 'Why we hold it',
          paragraphs: [
            'Every item above exists for one of three reasons: to run your account, to pay you correctly, or to prevent fraud. The transaction record in particular exists so that if you ever disagree with your balance, there is a complete history to check rather than our word for it.',
          ],
        },
        {
          heading: 'Who can see it',
          paragraphs: [
            'Fundxtra administrators can see your account details, your balance, your task history and your withdrawals, because that is what support and fraud review require. Every administrative action that changes your account — a balance adjustment, a suspension, a PIN reset — is recorded with who did it and why.',
            'Your data is stored using Google Firebase. Where a payout or reward is fulfilled by an external provider, we share only what that provider needs to complete it — for example a phone number for an airtime top-up.',
          ],
        },
        {
          heading: 'How long we keep it',
          paragraphs: [
            'Account and transaction records are kept while your account exists and for a period afterwards, because financial records need to remain available for dispute resolution. Proof screenshots are kept while the related task decision could reasonably be queried.',
          ],
        },
        {
          heading: 'Your choices',
          paragraphs: [
            'You can ask us what we hold about you, ask for a correction, or ask for your account to be closed and your personal details removed. Contact support and we will action it. Note that anonymised transaction records may be retained where we are required to keep financial history.',
          ],
        },
        {
          heading: 'Security',
          paragraphs: [
            'Telegram sign-in data is cryptographically verified on our server before any session is created. PINs are hashed with a deliberately slow algorithm and a value unique to your account. Proof uploads are stored privately and shown to reviewers through links that expire. No balance change happens anywhere except on our server, inside an atomic transaction that also writes the permanent record of it.',
          ],
        },
        {
          heading: 'Children',
          paragraphs: [
            'Fundxtra is not intended for anyone under 18. If we learn that an account belongs to a child, we close it.',
          ],
        },
        {
          heading: 'Changes',
          paragraphs: [
            'If this policy changes, the date at the top of this page changes with it and material changes are announced in the app.',
          ],
        },
      ]}
    />
  );
}
