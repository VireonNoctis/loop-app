import Link from "next/link"
import { getLegalPublicationInfo } from "@/lib/legal-operator"

const sections = [
  {
    id: "overview",
    num: "1",
    title: "Overview",
    body: [
      "This Privacy Policy explains how the Operator identified in the Controller and Contact Details section collects, uses, discloses, and protects personal information when you visit or use LOOP. It applies to visitors, account holders, contributors and people who communicate with the Service.",
      "We use personal information to provide the features you request, keep accounts and communities safe, meet legal obligations and improve the Service. We do not sell personal information. Reading this Policy is not the same as giving consent to every type of data processing; where the law requires consent for an optional purpose, we ask for it separately.",
    ],
  },
  {
    id: "collect",
    num: "2",
    title: "Information We Collect",
    body: ["We collect the following categories of information:"],
    list: [
      "Account information — when you register, we collect your email address, chosen username, display name, and password (stored only as a cryptographically hashed value). If you sign in with Google, we receive the name, email, and profile picture from your Google account that you authorize.",
      "Profile information — content you add to your profile, including a bio, avatar, banner image, location, website, phone number (if you choose to provide it), interests, and theme or cosmetic preferences.",
      "Content you create — loops, reels, comments, duels, circle posts, event registrations, live-stream chats, co-loop sessions, and any media you upload to the Service.",
      "Engagement data — likes, reactions, follows, branches, saves/bookmarks, views, shares, and the people and content you interact with, used to personalize your feed (including our recommendation features).",
      "Transactional data — records of Loop Coin transactions, gifts sent and received, purchases, referral rewards, and withdrawals.",
      "Device and usage data — technical information automatically collected when you use the Service, such as IP address, browser type and version, device identifiers, operating system, referring pages, and timestamps of your visits.",
      "Communication data — support tickets and messages you send to our support team.",
    ],
  },
  {
    id: "use",
    num: "3",
    title: "How We Use Your Information",
    body: ["We use your information to:"],
    list: [
      "Provide, operate, and maintain the Service, including authenticating you and keeping your account secure.",
      "Personalize your experience, including ranking your feed, suggesting users, circles, and events, and serving relevant recommendations.",
      "Enable social features, such as showing your content to other users, processing follows, likes, comments, gifts, and shares.",
      "Process purchases, subscriptions, virtual-currency transactions, referral rewards, and withdrawals.",
      "Send you service notifications (in-app, email, or push) about activity on your account, such as new followers, comments, gifts, or support replies.",
      "Detect, prevent, and respond to fraud, abuse, security incidents, and violations of our Terms of Service or Community Guidelines.",
      "Improve and develop the Service through analytics, debugging, and research.",
      "Comply with legal obligations and enforce our rights.",
    ],
  },
  {
    id: "legal-bases",
    num: "4",
    title: "Why We May Use Your Information",
    body: ["Data-protection law requires a lawful basis for each purpose. Depending on the feature and the specific processing, LOOP may rely on:"],
    list: [
      "Contract — to create and secure your account, provide the features you request, deliver messages and collaborations, manage purchases, and respond to account actions.",
      "Legitimate interests — to protect users, prevent fraud and abuse, moderate content, secure infrastructure, troubleshoot issues and improve reliability, where those interests are not overridden by your rights.",
      "Legal obligation — to keep records, respond to lawful requests, and meet tax, accounting, consumer-protection or other legal requirements.",
      "Consent — for optional processing where consent is the appropriate legal basis, such as certain optional communications or non-essential cookies where required. You can withdraw consent at any time; withdrawal does not affect processing that was lawful before withdrawal."
    ],
  },
  {
    id: "share",
    num: "5",
    title: "When We Share Your Information",
    body: ["We do not sell your personal information. We share your information only in the following circumstances:"],
    list: [
      "With service providers — providers actually used in production are identified in the Controller and Processing Details section below, together with their roles and processing locations. Optional integrations and development-only tools are not described as active production providers.",
      "With other users — the information you make public (your username, display name, avatar, posts, and interactions) is visible to other users as part of the Service's intended functionality.",
      "For safety and legal reasons — when we reasonably believe disclosure is required by law, regulation, legal process, or governmental request, or is necessary to protect the rights, property, or safety of loopapp.me, our users, or the public.",
      "In a business transfer — if we are involved in a merger, acquisition, reorganization, or sale of assets, your information may be transferred as part of that transaction, subject to this Privacy Policy.",
      "With your consent — we may share your information for other purposes when you direct us to do so.",
    ],
  },
  {
    id: "public",
    num: "6",
    title: "Public Information and Social Features",
    body: [
      "Most of the content you create on loopapp.me is public by default, including your profile, loops, reels, comments, duels, and circle posts. Public content may be viewed, searched, branched, and shared by other users and, where the Service allows, by visitors who are not signed in.",
      "Your profile shows your username, display name, avatar, bio, and information such as follower counts and engagement statistics. Think carefully before posting content you would not want to be public.",
      "Direct messages, gift records, and withdrawal details are private to you and the other party, except where we are required to disclose them by law or to investigate abuse.",
    ],
  },
  {
    id: "cookies",
    num: "7",
    title: "Cookies and Similar Technologies",
    body: [
      "LOOP uses essential cookies and similar technologies to keep you signed in, protect sessions, remember necessary preferences and keep the Service working. Some optional analytics or embedded features may use additional technologies. Where applicable law requires consent before non-essential cookies or device storage are used, they must remain disabled until you make that choice. You can also control cookies through your browser, although blocking essential cookies may prevent sign-in or other features from working.",
      "We also use analytics tools that may set their own cookies. You can disable cookies in your browser settings, but some parts of the Service may not work correctly without them.",
    ],
  },
  {
    id: "retention",
    num: "8",
    title: "Data Retention",
    body: [
      "We retain your personal information for as long as your account is active or as needed to provide the Service, comply with legal obligations, resolve disputes, and enforce our agreements.",
      "When you delete your account, we remove or de-identify information according to the deletion workflow and applicable legal requirements. Some records may be retained where necessary for security, dispute resolution, payment/accounting obligations or legal claims. The production data and backup retention periods are stated in the Controller and Processing Details section below.",
      "Transactional and financial records may be retained longer where required by law or our payment partners' policies.",
    ],
  },
  {
    id: "security",
    num: "9",
    title: "How We Protect Your Information",
    body: [
      "We use technical and organisational measures intended to protect information, including encrypted connections (TLS), password hashing, access controls for privileged systems, session security and monitoring for suspicious activity. Access to personal information should be limited to people and providers who need it for an authorised purpose.",
      "No method of transmission or storage is 100% secure. While we work to protect your information, we cannot guarantee its absolute security. You are responsible for keeping your password confidential and enabling all security features we offer.",
    ],
  },
  {
    id: "rights",
    num: "10",
    title: "Your Rights and Choices",
    body: ["Depending on your location, you may have the following rights regarding your personal information:"],
    list: [
      "Access — request a copy of the personal information we hold about you.",
      "Correction — update or correct inaccurate information (you can also edit most profile fields directly in Settings).",
      "Deletion — request that we delete your personal information (you can also delete your account from Settings).",
      "Portability — request your information in a structured, machine-readable format where technically feasible.",
      "Restriction and objection — object to or request restriction of certain processing, including direct marketing.",
      "Withdraw consent — where processing is based on consent, withdraw it at any time without affecting the lawfulness of prior processing.",
      "Opt out of marketing — follow the unsubscribe instructions in any marketing email we send.",
    ],
    body2:
      "To exercise these rights, sign in and open the Help & Support Center at /help. Choose “Privacy & data request” and describe the right you want to exercise. We may ask for information needed to verify your identity. People who cannot sign in may contact the monitored privacy email published in the Controller and Processing Details section below."
  },
  {
    id: "children",
    num: "11",
    title: "Children's Privacy",
    body: [
      "The Service has a minimum account age of 13, or a higher minimum where local law requires one. This service-age rule is separate from the GDPR age of digital consent. In Ireland, the age of digital consent is 16 where an online service relies on a child's consent as its legal basis for processing personal data; for a child below 16, that consent must be given or authorised by the holder of parental responsibility. This does not make 16 a universal minimum age for every online service. LOOP must not rely on a child's own consent for a processing purpose where valid parent or guardian authorisation is legally required. Children also have data-protection rights, and age-appropriate privacy and safety protections must be applied."
    ],
  },
  {
    id: "international",
    num: "12",
    title: "International Data Transfers",
    body: [
      "The production processing locations and international transfer position are stated in the Controller and Processing Details section below. Where personal information is transferred internationally, the Operator must identify the destination and the applicable transfer mechanism and supplementary safeguards."
    ],
  },
  {
    id: "changes",
    num: "13",
    title: "Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. When we make material changes, we will update the \"Last updated\" date below and notify you through the Service or by email where appropriate. If a change requires renewed acknowledgement or consent, we will ask you to complete that step before the affected processing or account features continue where required by law. Continued browsing or silence is not treated as consent where the law requires an affirmative choice.",
    ],
  },
  {
    id: "contact",
    num: "14",
    title: "Contact Us",
    body: [
      "For privacy and data-protection requests, use the Help & Support Center at /help and choose “Privacy & data request”. You may also lodge a complaint with the data-protection supervisory authority in your country. In Ireland, this is the Data Protection Commission. The Operator's identity and monitored privacy contact are published in the Controller and Processing Details section above."
    ],
  },
]

export default function PrivacyPolicyPage() {
  const legalInfo = getLegalPublicationInfo()

  return (
    <main className="legal-document min-h-screen w-full min-w-0 bg-background">
      <div className="mx-auto w-full min-w-0 max-w-4xl px-3 py-8 sm:px-4 sm:py-10">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Version 1.2 · Last updated: 3 November 2026
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            This Policy explains what personal information LOOP uses, why it is needed, who may receive it,
            how long it is kept and what choices and rights you have. Read it with the{" "}
            <Link href="/terms" className="font-medium text-primary underline underline-offset-4">Terms of Service</Link>.
          </p>
          <div className="mt-6 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <p className="text-sm font-semibold">Privacy, in plain language</p>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
              <li>We use account details to sign you in and keep your account secure.</li>
              <li>Content you choose to make public can be seen and shared by other people.</li>
              <li>Private messages and restricted Circle content should only be available to authorised participants.</li>
              <li>We do not sell personal information.</li>
              <li>You can ask for access, correction, deletion or a copy of your information, subject to legal limits.</li>
              <li>Optional processing that relies on consent must be explained and requested separately where required.</li>
            </ul>
          </div>
          <section aria-labelledby="controller-details-heading" className="mt-4 rounded-xl border border-border bg-card p-4 text-sm leading-6">
            <h2 id="controller-details-heading" className="font-semibold">Controller and processing details</h2>
            {legalInfo.operatorName ? <p className="mt-2 font-medium">{legalInfo.operatorName}</p> : null}
            {legalInfo.operatorAddress ? <p className="whitespace-pre-wrap text-muted-foreground">{legalInfo.operatorAddress}</p> : null}
            {legalInfo.operatorCountry ? <p className="text-muted-foreground">{legalInfo.operatorCountry}</p> : null}
            {legalInfo.privacyContactEmail ? <p>Privacy contact: <a className="underline underline-offset-4" href={"mailto:" + legalInfo.privacyContactEmail}>{legalInfo.privacyContactEmail}</a></p> : null}
            <dl className="mt-4 grid gap-3">
              <div><dt className="font-medium">Production service providers and roles</dt><dd className="whitespace-pre-wrap text-muted-foreground">{legalInfo.processors || "Not configured"}</dd></div>
              <div><dt className="font-medium">Processing and storage locations</dt><dd className="whitespace-pre-wrap text-muted-foreground">{legalInfo.processingLocations || "Not configured"}</dd></div>
              <div><dt className="font-medium">International transfers and safeguards</dt><dd className="whitespace-pre-wrap text-muted-foreground">{legalInfo.transferDetails || "Not configured"}</dd></div>
              <div><dt className="font-medium">Data retention schedule</dt><dd className="whitespace-pre-wrap text-muted-foreground">{legalInfo.dataRetention || "Not configured"}</dd></div>
              <div><dt className="font-medium">Backup retention and deletion</dt><dd className="whitespace-pre-wrap text-muted-foreground">{legalInfo.backupRetention || "Not configured"}</dd></div>
            </dl>
            {!legalInfo.publicationReady ? (
              <div role="alert" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Publication is blocked.</strong> The service owner must complete these verified details before users can accept this Policy:
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {legalInfo.missingFields.map((field) => <li key={field.key}>{field.label}</li>)}
                </ul>
              </div>
            ) : <p className="mt-3 text-xs text-muted-foreground">Disclosures supplied by the production deployment configuration.</p>}
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
          <p className="text-sm font-semibold">Your data rights</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Visit the <Link href="/help" className="font-medium text-primary underline underline-offset-4">Help &amp; Support Center</Link>,
            sign in and choose “Privacy &amp; data request”. You may also complain to your local data-protection
            supervisory authority. In Ireland, that authority is the Data Protection Commission.
          </p>
          <Link href="/terms" className="mt-4 inline-flex text-sm font-medium text-primary underline underline-offset-4">
            Read the Terms of Service
          </Link>
        </div>
      </div>
    </main>
  )
}
