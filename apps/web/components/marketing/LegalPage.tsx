import { tokens } from '@fundxtra/shared';

/**
 * Legal document layout.
 *
 * Plain, readable prose at a comfortable measure. Terms nobody can read are
 * terms nobody agreed to, so this is deliberately typographic rather than
 * designed — generous line height, a 68ch measure, real heading hierarchy.
 */

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export function LegalPage({
  title,
  updated,
  intro,
  sections,
  contact,
}: {
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  contact: { handle: string; url: string };
}) {
  return (
    <article style={{ padding: '56px 20px 88px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <p
          style={{
            fontSize: tokens.typography.size.xs,
            fontWeight: tokens.typography.weight.bold,
            letterSpacing: tokens.typography.tracking.wider,
            textTransform: 'uppercase',
            color: tokens.semantic.brand,
          }}
        >
          Fundxtra
        </p>
        <h1
          style={{
            marginTop: 10,
            fontSize: 'clamp(1.875rem, 5vw, 2.625rem)',
            letterSpacing: tokens.typography.tracking.tighter,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            marginTop: 10,
            fontSize: tokens.typography.size.sm,
            color: tokens.semantic.inkSubtle,
          }}
        >
          Last updated {updated}
        </p>
        <p
          style={{
            marginTop: 24,
            maxWidth: '68ch',
            fontSize: tokens.typography.size.lg,
            lineHeight: tokens.typography.leading.relaxed,
            color: tokens.semantic.inkMuted,
          }}
        >
          {intro}
        </p>

        <div style={{ marginTop: 40, display: 'grid', gap: 32 }}>
          {sections.map((section, index) => (
            <section key={section.heading}>
              <h2
                style={{
                  fontSize: tokens.typography.size.xl,
                  letterSpacing: tokens.typography.tracking.tight,
                }}
              >
                {index + 1}. {section.heading}
              </h2>
              {section.paragraphs?.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 40)}
                  style={{
                    marginTop: 12,
                    maxWidth: '68ch',
                    fontSize: tokens.typography.size.md,
                    lineHeight: tokens.typography.leading.relaxed,
                    color: tokens.semantic.inkMuted,
                  }}
                >
                  {paragraph}
                </p>
              ))}
              {section.bullets && (
                <ul
                  style={{
                    margin: '14px 0 0',
                    paddingLeft: 22,
                    display: 'grid',
                    gap: 8,
                    maxWidth: '68ch',
                  }}
                >
                  {section.bullets.map((bullet) => (
                    <li
                      key={bullet.slice(0, 40)}
                      style={{
                        fontSize: tokens.typography.size.md,
                        lineHeight: tokens.typography.leading.relaxed,
                        color: tokens.semantic.inkMuted,
                      }}
                    >
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        <div
          style={{
            marginTop: 48,
            padding: 22,
            background: tokens.colors.cocoa[50],
            border: `1px solid ${tokens.colors.cocoa[200]}`,
            borderRadius: tokens.radii.lg,
          }}
        >
          <h2
            style={{
              fontSize: tokens.typography.size.lg,
              fontWeight: tokens.typography.weight.semibold,
            }}
          >
            Questions about this document
          </h2>
          <p
            style={{
              marginTop: 8,
              fontSize: tokens.typography.size.base,
              lineHeight: tokens.typography.leading.relaxed,
              color: tokens.semantic.inkMuted,
            }}
          >
            Contact Fundxtra Support on Telegram at{' '}
            <a
              href={contact.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: tokens.semantic.brandInk, textDecoration: 'underline' }}
            >
              {contact.handle}
            </a>
            .
          </p>
        </div>
      </div>
    </article>
  );
}
