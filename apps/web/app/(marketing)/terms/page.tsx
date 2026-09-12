import type { Metadata } from 'next';
import { LegalPage } from '@/components/marketing/LegalPage';
import { fallbackConfig, getPublicConfig } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Terms of use',
  description:
    'The terms that govern your use of Fundxtra: how earning works, how rewards are paid, and what is not allowed.',
  alternates: { canonical: '/terms' },
};

export default async function TermsPage() {
  const site = (await getPublicConfig()) ?? fallbackConfig();

  return (
    <LegalPage
      title="Terms of use"
      updated="12 September 2026"
      intro="These terms describe what Fundxtra does, what you can expect from us, and what we expect from you. They are written to be read rather than to be impressive."
      contact={{ handle: site.brand.supportHandle, url: site.brand.supportUrl }}
      sections={[
        {
          heading: 'What Fundxtra is',
          paragraphs: [
            'Fundxtra is a rewards platform that operates through Telegram. Sponsors fund campaigns, you complete the actions those campaigns describe, and we pay you in Nigerian Naira. You can withdraw that balance to a Nigerian bank account, or spend it on the reward options available in the app.',
            'Fundxtra is not an investment, a savings product, or a scheme that pays a return on money you deposit. You never pay Fundxtra anything, and there is nothing to deposit.',
          ],
        },
        {
          heading: 'Your account',
          paragraphs: [
            'Your Fundxtra account is tied to your Telegram account. One Telegram account is one Fundxtra account. You are responsible for keeping access to your Telegram account secure, because anyone with it can open your Fundxtra app.',
            'Your 4-digit PIN is an additional protection for withdrawals and redemptions. We store it in a form we cannot reverse, so we can never tell you what your PIN is — support can only reset it so you can choose a new one. Fundxtra staff will never ask you for your PIN.',
          ],
        },
        {
          heading: 'Earnings are not guaranteed',
          paragraphs: [
            'What you can earn depends entirely on the campaigns sponsors are funding at the time and the tasks you actually complete. We do not promise, guarantee, project or imply any level of income, and we do not offer any figure for what a typical user earns.',
            'Campaign budgets are finite. When a campaign is fully claimed it closes, even if you were about to submit. This is shown in the app before you start a task.',
          ],
        },
        {
          heading: 'How rewards are credited',
          paragraphs: [
            'Some tasks are verified automatically — for example, we can ask Telegram directly whether you joined a channel. Those credit your balance immediately.',
            'Other tasks require proof, usually a screenshot. Those are reviewed by a person, and no reward is credited until that review approves the submission. If a submission is rejected you will see the reason, and the budget held for it is released back to the campaign.',
          ],
          bullets: [
            'Rewards are capped at a maximum per task, shown in the app.',
            'Each task can normally be completed once per account.',
            'A credited reward may be reversed if we later find the completion was fraudulent. The reversal, and the reason, is recorded on your account.',
          ],
        },
        {
          heading: 'Referrals',
          paragraphs: [
            'You earn a referral reward when someone opens Fundxtra through your link, creates their PIN, and reaches their dashboard. They do not need to complete a task.',
            'One Telegram account can only ever be referred once. Referring yourself, creating additional accounts to refer, or using automated means to generate referrals is not allowed and results in those referrals being rejected.',
          ],
        },
        {
          heading: 'Withdrawals and redemptions',
          paragraphs: [
            'The withdrawal portal is opened and closed by us. When it is closed, the app tells you so and why. Your balance is unaffected by the portal being closed.',
            'You are responsible for the accuracy of the bank details you provide. A payout sent to details you entered incorrectly may not be recoverable. If a payout fails, the amount is returned to your balance with a record of the failure.',
            'Reward options other than cash depend on external fulfilment services. Where such a service is not yet available, that reward is shown as coming soon and cannot be redeemed — we will not take your balance for something we cannot deliver.',
          ],
        },
        {
          heading: 'What is not allowed',
          bullets: [
            'Creating more than one Fundxtra account.',
            'Using bots, scripts, emulators or automation to complete tasks.',
            'Submitting a screenshot that is edited, reused, or not of your own completion.',
            'Attempting to claim a reward for a task you did not complete.',
            'Interfering with our systems, or attempting to manipulate balances, referrals or reward APIs.',
            'Selling, transferring or sharing your account.',
          ],
          paragraphs: [
            'Where we find any of the above, we may suspend the account while we review it, reverse affected rewards, and in serious or repeated cases close the account. We flag behaviour for human review rather than banning automatically, and you can contact support about any decision.',
          ],
        },
        {
          heading: 'Suspension and closure',
          paragraphs: [
            'We may suspend an account while investigating suspicious activity. Suspension pauses earning and withdrawal but does not delete your balance or your history.',
            'You can stop using Fundxtra at any time. If you want your account closed, contact support.',
          ],
        },
        {
          heading: 'Availability',
          paragraphs: [
            'Fundxtra is provided as it is. We work to keep it available and correct, but we do not guarantee uninterrupted service, and we may take the platform down for maintenance. Where that affects earning or withdrawals, we say so in the app.',
          ],
        },
        {
          heading: 'Changes to these terms',
          paragraphs: [
            'We may update these terms. The date at the top of this page shows when they last changed, and material changes are announced in the app. Continuing to use Fundxtra after a change means you accept the updated terms.',
          ],
        },
      ]}
    />
  );
}
