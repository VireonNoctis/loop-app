import Link from "next/link"
import { getLegalPublicationInfo } from "@/lib/legal-operator"

const sections = [
  {
    id: "acceptance",
    num: "1",
    title: "Acceptance of These Terms",
    body: [
      "Welcome to loopapp.me (\"loopapp.me\", \"we\", \"us\", or \"our\"). These Terms of Service (\"Terms\") form an agreement between you (\"you\" or \"your\") and the person or legal entity operating loopapp.me (the Operator), governing your access to the platform, including its website, mobile applications, and related services, features, tools, and content (collectively, the \"Service\").",
      "Creating an account does not, by itself, record your agreement to these Terms. Before you can use account features, you must review these Terms and the Privacy Policy and complete the separate agreement step presented by LOOP. Your agreement is recorded with the versions of the documents shown to you and the time you accepted them. If you do not agree to these Terms, do not accept them or use account features.",
      "If you are using the Service on behalf of an organization (including as an Organization account under Section 10), you represent and warrant that you have the authority to bind that organization to these Terms.",
    ],
  },
  {
    id: "eligibility",
    num: "2",
    title: "Eligibility and Accounts",
    body: [
      "You must be at least 13 years old to create an account, or older if the law where you live sets a higher minimum age for this type of service. The minimum age to use a service is not the same as the age at which a child can provide their own consent to every kind of personal-data processing. Where applicable law requires a parent or guardian to authorise consent-based processing, LOOP must obtain that authorisation before relying on the child's consent for that processing. Do not enter a false date of birth or use another person's identity.",
      "You are responsible for keeping your sign-in credentials secure and for activity carried out through your account. Tell us promptly about suspected unauthorised access through the Help & Support Center at /help. A support ticket requires you to sign in so that we can verify and respond to the account holder.",
      "You may not create multiple accounts to circumvent restrictions we impose or to artificially inflate engagement, rewards, or referral bonuses. We may suspend or terminate accounts that we reasonably believe were created or used in violation of this Section.",
    ],
  },
  {
    id: "service",
    num: "3",
    title: "Description of the Service",
    body: [
      "loopapp.me is a collaborative social platform that lets you create, share, and build on content. The Service includes, without limitation:",
    ],
    list: [
      "Loops — original posts (text, image, video, or code) that other users can \"branch\" from to build connected, tree-like structures of content.",
      "Co-Loops — real-time collaborative writing sessions where a Primary Creator and invited Co-Authors write and publish a post together from a live studio.",
      "Duels — public side-by-side debates or polls where the community votes on an outcome.",
      "Circles — community spaces where members join, post, host events, and collaborate on shared topics.",
      "Reels — short-form video content with comments, likes, and branching.",
      "Live Streams — real-time broadcast rooms with chat and viewer interaction.",
      "Loop Coins — an in-app virtual currency earned through engagement and usable in the Loop Shop, for gifts, boosts, and other virtual items.",
      "Premium (\"Pro\") — paid subscription tiers unlocking exclusive badges, cosmetics, perks, and features.",
      "Marketplace — a space to discover and install community-built apps, tools, and integrations.",
      "Events, Games, GIFs, Gifts, Referrals, Organization accounts, and other features we may add from time to time.",
    ],
    body2:
      "We may add, change, suspend, or remove features at any time with or without notice, and we do not guarantee that any feature will remain available.",
  },
  {
    id: "content",
    num: "4",
    title: "User Content and Your License to Us",
    body: [
      "You keep ownership of the content you create or upload (\"User Content\"). You grant LOOP a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, technically adapt (for example, resize or transcode media), display and deliver that content only as needed to operate the Service and the features you choose to use. We may allow our infrastructure and service providers to process the content for those purposes, and may make it available to the people you choose to share or collaborate with. This licence does not transfer ownership to LOOP and does not give LOOP a general right to sell your content or use it in unrelated advertising. It lasts for as long as the content is available through the Service and for any limited period needed for backups, legal obligations, security investigations or dispute resolution.",
      "You are responsible for making sure you have the rights and permissions needed to upload and share your User Content. Do not post another person's private information, images, recordings or work unless you have a lawful basis and any permission required. Your content must follow these Terms, the Community Guidelines and applicable law.",
      "If you believe content on the Service infringes your copyright or other rights, report it through the Help & Support Center at /help and select the closest available category. Use the legal contact published at the top of this document for formal notices. The Operator must maintain a legally compliant notice process for the countries where the Service is offered.",
    ],
  },
  {
    id: "conduct",
    num: "5",
    title: "Prohibited Conduct",
    body: ["You agree not to use the Service to:"],
    list: [
      "Post content that is unlawful, defamatory, harassing, hateful, threatening, obscene, or that exploits or harms minors.",
      "Impersonate any person or entity, or misrepresent your affiliation, identity, or credentials.",
      "Engage in spam, phishing, fraud, deceptive practices, or the manipulation of engagement metrics, votes, duels, or rewards.",
      "Distribute malware, viruses, or any code intended to disrupt, damage, or gain unauthorized access to the Service or other users' devices.",
      "Attempt to access, scrape, or collect data from the Service using automated tools, except as expressly permitted by our public APIs and developer policies.",
      "Interfere with or disrupt the Service, its servers, or networks, including denial-of-service attacks or excessive automated requests.",
      "Buy, sell, or otherwise transfer accounts, usernames, or virtual currency outside of the Service's sanctioned mechanics.",
      "Use the Service to send unsolicited commercial messages to other users.",
      "Encourage, facilitate, or assist any of the foregoing.",
    ],
    body2:
      "We may review reports, restrict or remove content, limit features, or suspend an account where we reasonably consider it necessary to enforce these Terms, protect users, investigate abuse, comply with law or respond to an urgent safety risk. Where required by applicable law, we will provide an explanation of the action and access to an available internal complaint or appeal process. We may act without advance notice where urgent action is needed to protect people, the Service or evidence.",
  },
  {
    id: "virtual-currency",
    num: "6",
    title: "Loop Coins, Virtual Items, and Purchases",
    body: [
      "Loop Coins are virtual points with no monetary value and cannot be redeemed for cash or any real-world currency (unless a specific, separately published redemption program says otherwise). Coins may be earned through platform activity or acquired through in-app purchases processed by third-party payment providers.",
      "Virtual items purchased with Loop Coins (including gifts, boosts, cosmetics, themes, and catalog effects) are licensed to you for personal, non-commercial use within the Service and may not be transferred, sold, or exchanged outside the Service.",
      "All purchases are final. Unless required by applicable consumer law or our Refund Policy (Section 7A), we do not offer refunds for virtual currency, virtual items, or subscription fees already paid.",
      "We may adjust, expire, or revoke Loop Coins or virtual items if we determine they were obtained through fraud, abuse, or violation of these Terms.",
    ],
  },
  {
    id: "subscriptions",
    num: "7",
    title: "Premium (Pro) Subscriptions",
    body: [
      "Premium subscriptions grant access to exclusive features, badges, cosmetics, and perks described on the Premium page. Subscription fees and billing cycles are displayed before purchase.",
      "Subscriptions renew automatically at the end of each billing period until cancelled. You can cancel at any time through your account settings; cancellation takes effect at the end of the current billing period, and you will retain access to paid features until then.",
      "We reserve the right to change subscription pricing for future billing cycles. We will provide reasonable notice of price changes before they take effect.",
      "If you are granted Premium through an admin action, a promotion, or a reward (such as an organization perk), those grants are at our discretion and may be revoked at any time without refund.",
    ],
  },
  {
    id: "refund-policy",
    num: "7A",
    title: "Refund Policy",
    body: [
      "This policy explains how to request a refund for a real-money purchase made through LOOP. The payment provider shown at checkout processes the payment. Promotional or complimentary benefits are not cash purchases. Nothing in this policy removes a cancellation, withdrawal, conformity or refund right that mandatory consumer law gives you.",
    ],
    list: [
      "Consumer withdrawal rights — Depending on your location and the type of digital service or content purchased, you may have a statutory period in which to withdraw from an online purchase. In Ireland and the EU, a 14-day withdrawal period commonly applies to online service contracts, subject to legal exceptions. For digital content or services supplied immediately, any legally required express request, consent or acknowledgement about the effect on that right must be presented separately at checkout; accepting these Terms is not a substitute for it.",
      "How to request — Use the Help & Support Center at /help and select Billing & Payments. Sign in so we can identify the transaction. Include the purchase date and transaction reference, but never send full card numbers or security codes.",
      "Processing — If a refund is approved, it will normally be returned to the original payment method. The payment provider and your bank control the time it takes to appear. Any reversal of Coins, items or subscription access will be explained as part of the decision and will not limit mandatory consumer rights.",
      "Virtual balances — Loop Coins are not a bank balance, deposit or general-purpose payment instrument. They cannot be sold or transferred outside LOOP and have no cash redemption value unless a separate, lawful creator-payout arrangement expressly applies. This does not remove statutory rights that apply to the original purchase.",
      "Abuse — We may decline refund requests where we reasonably suspect fraud, abuse, or repeated refund requests (for example, buying a coin pack, spending the coins, then requesting a refund). Repeated abuse may result in suspension.",
      "Statutory rights — Nothing in this policy limits any mandatory consumer-protection rights you may have under the law of your country or state. If a mandatory right requires a longer refund window or different treatment, that right prevails.",
    ],
  },
  {
    id: "referrals",
    num: "8",
    title: "Referral Program",
    body: [
      "The Referral Program rewards you with Loop Coins when a new user signs up using your unique invite link and completes the qualifying actions described in the Settings → Referrals page (for example, completing onboarding and making a first post).",
      "Rewards are credited to your account only when the referred user is not a previously existing account and does not use the same device, payment method, or IP address cluster we reasonably associate with abuse.",
      "We may withhold or claw back referral rewards if we determine that the program is being abused, including self-referrals, duplicate accounts, or incentivized fake signups.",
    ],
  },
  {
    id: "gifts",
    num: "9",
    title: "Gifts, Donations, and Withdrawals",
    body: [
      "Users may send virtual gifts to other users using Loop Coins. Gifts are virtual items and do not create a monetary obligation to the recipient unless a separately published creator-payout program applies.",
      "If you participate in a creator-payout or withdrawal program (such as withdrawing available earnings), you represent that you are legally able to receive the funds, that all information you provide is accurate, and that you will comply with all applicable tax laws. Withdrawals are subject to minimum thresholds, verification, and anti-fraud review.",
      "We may delay, withhold, or reverse payouts where we suspect fraud, chargebacks, or violations of these Terms.",
    ],
  },
  {
    id: "organizations",
    num: "10",
    title: "Organization Accounts",
    body: [
      "Organization accounts are user accounts that have enabled Organization Mode (where eligible) and may represent a brand, community, or business. Organization owners are responsible for all activity under the organization account, including posts, events, perks, and member interactions.",
      "Organization perks, boost discounts, coin-rate multipliers, and exclusive rewards are configurable by the organization owner and may be modified, limited, or revoked by us at any time.",
      "Events hosted by organizations are community events; we are not a party to, and are not responsible for, the fulfillment of any promises made by organizations to their members.",
    ],
  },
  {
    id: "ip",
    num: "11",
    title: "Intellectual Property",
    body: [
      "The Service, including its software, design, graphics, logos, trademarks, and all non-User Content, is owned by or licensed to loopapp.me and is protected by intellectual property laws. Unless expressly permitted, you may not copy, modify, distribute, sell, lease, or create derivative works of any part of the Service.",
      "We welcome feedback and suggestions, but by submitting ideas you grant us a perpetual, irrevocable, royalty-free license to use them without any obligation to you.",
    ],
  },
  {
    id: "third-party",
    num: "12",
    title: "Third-Party Services",
    body: [
      "The Service may integrate with third-party services (for example, payment processors, GIF providers, or the Google sign-in provider). Your use of those services may be subject to the third party's own terms and privacy policy, and we are not responsible for third-party services.",
      "The Marketplace may list community-built apps and tools. Those items are provided by their respective developers \"as is\"; we do not warrant their functionality and are not liable for their operation.",
    ],
  },
  {
    id: "termination",
    num: "13",
    title: "Termination and Account Deletion",
    body: [
      "You may delete your account at any time from Settings. Deleting your account will remove your profile and, where technically feasible, your content from public display; copies may remain in backups for a reasonable retention period.",
      "We may suspend or terminate your account, or restrict your access, with or without notice, if we believe you have violated these Terms, the Community Guidelines, or applicable law, or if your conduct creates risk or harm to the Service or other users.",
      "Upon termination, your right to use the Service ceases immediately. Virtual currency and virtual items have no cash value and will not be refunded.",
    ],
  },
  {
    id: "disclaimers",
    num: "14",
    title: "Disclaimer of Warranties",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY, OR UNINTERRUPTED OR ERROR-FREE OPERATION.",
      "WE DO NOT WARRANT THAT THE SERVICE WILL MEET YOUR REQUIREMENTS, THAT CONTENT WILL BE ACCURATE OR RELIABLE, OR THAT DEFECTS WILL BE CORRECTED. ANY CONTENT DOWNLOADED OR OTHERWISE OBTAINED THROUGH THE SERVICE IS ACCESSED AT YOUR OWN RISK, AND YOU ARE SOLELY RESPONSIBLE FOR ANY DAMAGE TO YOUR DEVICE OR DATA.",
    ],
  },
  {
    id: "liability",
    num: "15",
    title: "Limitation of Liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, NEITHER LOOP NOR ITS AFFILIATES, OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS SHALL BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING LOSS OF PROFITS, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF (OR INABILITY TO USE) THE SERVICE.",
      "OUR TOTAL AGGREGATE LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN THE SIX (6) MONTHS PRECEDING THE CLAIM, OR (B) ONE HUNDRED US DOLLARS ($100). SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES, SO SOME OF THE ABOVE LIMITATIONS MAY NOT APPLY TO YOU.",
    ],
  },
  {
    id: "indemnity",
    num: "16",
    title: "Indemnification",
    body: [
      "You agree to indemnify, defend, and hold harmless loopapp.me and its affiliates, officers, directors, employees, and agents from and against any and all claims, damages, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) your User Content; (b) your use of the Service; (c) your violation of these Terms; or (d) your violation of any rights of a third party.",
    ],
  },
  {
    id: "disputes",
    num: "17",
    title: "Governing Law and Dispute Resolution",
    body: [
      "Mandatory consumer, privacy and data-protection rights in the country where you live continue to apply. The operator's country of establishment and the governing-law details must be completed by the Service operator before these Terms are treated as final; they cannot be inferred from the loopapp.me domain.",
      "You can first try to resolve a service issue through the Help & Support Center at /help. Nothing in these Terms prevents you from contacting a regulator, supervisory authority or court, or from using a mandatory complaint or dispute process available under the law that applies to you.",
      "If any provision of these Terms is held to be invalid or unenforceable, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.",
    ],
  },
  {
    id: "changes",
    num: "18",
    title: "Changes to These Terms",
    body: [
      "We may update these Terms when the Service, its features or legal requirements change. We will update the version and date shown above and provide notice of material changes through the Service where appropriate. Where a change requires renewed agreement, we will ask you to review and accept the new version before continuing to use account features; simply continuing to browse is not treated as a substitute for an explicit acceptance where one is required.",
      "If you do not agree to the revised Terms, you must stop using the Service before the changes take effect.",
    ],
  },
  {
    id: "contact",
    num: "19",
    title: "Contact Us",
    body: [
      "For account help, visit the Help & Support Center at /help. For formal legal notices, contact the Operator using the legal contact details published at the top of this document. For data-protection requests, use the privacy contact published in the Privacy Policy.",
    ],
  },
]

export default function TermsOfServicePage() {
  const legalInfo = getLegalPublicationInfo()

  return (
    <main className="legal-document min-h-screen w-full min-w-0 bg-background">
      <div className="mx-auto w-full min-w-0 max-w-4xl px-3 py-8 sm:px-4 sm:py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Terms of Service</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Version 1.2 · Last updated: 3 November 2026
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            These Terms explain how LOOP works, what you may share, how collaboration and moderation operate,
            and the rules for paid features. Read them together with the{" "}
            <Link href="/privacy" className="font-medium text-primary underline underline-offset-4">Privacy Policy</Link>.
            Your agreement is recorded separately on the legal review page.
          </p>
          <div className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <p className="text-sm font-semibold">The essentials, in plain language</p>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
              <li>Keep your account secure and be truthful about your identity and age.</li>
              <li>Share only content you own or have permission to use, and respect other people's privacy.</li>
              <li>You keep ownership of your content; LOOP receives only the limited licence needed to run the features you use.</li>
              <li>Treat people respectfully. Harassment, exploitation, impersonation and abuse are not allowed.</li>
              <li>Coins and virtual items are not cash. Paid subscriptions renew until you cancel, subject to your legal rights.</li>
              <li>Report problems. Where required, LOOP explains significant moderation actions and provides an available review route.</li>
            </ul>
          </div>
          <section aria-labelledby="operator-details-heading" className="mt-4 rounded-xl border border-border bg-card p-4 text-sm leading-6">
            <h2 id="operator-details-heading" className="font-semibold">Operator details</h2>
            {legalInfo.operatorName ? <p className="mt-2 font-medium">{legalInfo.operatorName}</p> : null}
            {legalInfo.operatorAddress ? <p className="whitespace-pre-wrap text-muted-foreground">{legalInfo.operatorAddress}</p> : null}
            {legalInfo.operatorCountry ? <p className="text-muted-foreground">{legalInfo.operatorCountry}</p> : null}
            {legalInfo.operatorRegistration ? <p className="text-muted-foreground">Registration: {legalInfo.operatorRegistration}</p> : null}
            {legalInfo.legalContactEmail ? <p>Legal contact: <a className="underline underline-offset-4" href={"mailto:" + legalInfo.legalContactEmail}>{legalInfo.legalContactEmail}</a></p> : null}
            {legalInfo.privacyContactEmail ? <p>Privacy contact: <a className="underline underline-offset-4" href={"mailto:" + legalInfo.privacyContactEmail}>{legalInfo.privacyContactEmail}</a></p> : null}
            {!legalInfo.publicationReady ? (
              <div role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Publication is blocked.</strong> The service owner must complete these verified details before users can accept the documents:
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {legalInfo.missingFields.map((field) => <li key={field.key}>{field.label}</li>)}
                </ul>
              </div>
            ) : <p className="mt-3 text-xs text-muted-foreground">Details supplied by the service deployment configuration.</p>}
          </section>
        </div>

        <nav className="mb-10 rounded-2xl border border-border bg-card p-5">
          <p className="mb-3 text-sm font-semibold">Table of contents</p>
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm text-muted-foreground transition-colors hover:text-primary">
                  {s.num}. {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {sections.map((s) => (
          <section key={s.id} id={s.id} className="mb-9 scroll-mt-24">
            <h2 className="mb-3 text-xl font-semibold tracking-tight sm:text-2xl">
              <span className="mr-2 text-muted-foreground">{s.num}.</span>
              {s.title}
            </h2>
            <div className="space-y-3">
              {s.body?.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                  {p}
                </p>
              ))}
              {s.list && (
                <ul className="list-disc space-y-2 pl-6">
                  {s.list.map((item, i) => (
                    <li key={i} className="text-sm leading-relaxed text-muted-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {s.body2 && <p className="text-sm leading-relaxed text-muted-foreground">{s.body2}</p>}
            </div>
          </section>
        ))}

        <div className="mt-12 rounded-2xl border border-border bg-card p-6">
          <p className="text-sm font-semibold">Need help?</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Visit the <Link href="/help" className="font-medium text-primary underline underline-offset-4">Help &amp; Support Center</Link>.
            Sign in and choose “Privacy &amp; data request” for a privacy-related request.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <Link href="/privacy" className="font-medium text-primary underline underline-offset-4">Read the Privacy Policy</Link>
            <Link href="/legal/consent?returnTo=%2F" className="font-medium text-primary underline underline-offset-4">Review your agreement</Link>
          </div>
        </div>
      </div>
    </main>
  )
}
