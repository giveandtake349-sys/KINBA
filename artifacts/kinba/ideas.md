# NIVO Design Direction

## Approach 1

**Theme Name:** Signal Noir

**Very Brief Intro:** A dark, premium interface where human needs and capabilities are treated as luminous signals crossing a calm global field. It feels intelligent and futuristic without becoming a gaming or crypto aesthetic.

**Probability:** 0.07

## Approach 2

**Theme Name:** Civic Future

**Very Brief Intro:** A warm, editorial technology system with light surfaces, precise typography, and civic-minded clarity. It frames connection as infrastructure for everyday human progress.

**Probability:** 0.04

## Approach 3

**Theme Name:** Orbital Commons

**Very Brief Intro:** A dark atmospheric platform with soft orbital geometry, restrained blue-violet light, and spatial composition. It positions NIVO as a calm global layer connecting people across distance.

**Probability:** 0.09

## Chosen Approach: Signal Noir

**Design Movement:** Contemporary digital modernism with influences from Swiss International Typographic Style, premium fintech interfaces, and cinematic information design.

**Core Principles:**

1. Make the I NEED ↔ I CAN loop visually unmistakable within the first viewport.
2. Use dark navy space as a calm stage, with cyan signal accents reserved for actions and connection states.
3. Prefer asymmetric composition, editorial hierarchy, and purposeful whitespace over dashboard density.
4. Make every interaction feel trustworthy, legible, and lightweight on a one-handed mobile device.

**Color Philosophy:** NIVO uses near-black navy as a stable, quiet surface that lets human intent stand out. Cyan represents possibility and forward motion; a muted blue-violet atmosphere provides depth without the visual aggression of neon. Warm off-white text keeps the experience human and readable.

**Layout Paradigm:** A vertically paced narrative with a left-anchored editorial rail on larger screens and a stacked signal flow on mobile. The hero uses offset cards and a central connection path rather than a centered marketing block. Product surfaces remain close to the thumb zone, with a persistent mobile navigation bar.

**Signature Elements:**

- Thin cyan connection paths with small moving nodes between NEED and CAN states.
- Offset glass cards with a fine inner highlight and restrained blue-violet shadow.
- Small uppercase signal labels, numbered steps, and a recurring split-arrow motif.

**Interaction Philosophy:** Actions should feel like publishing intent, not submitting a form. Inputs emphasize clarity and low friction; button states confirm that a need or capability has entered the network. Placeholder-only future features should communicate their status rather than imply backend functionality.

**Animation:** Use 160–240ms transitions for buttons, cards, tabs, and menus. On page load, reveal hero copy and cards in a 40ms stagger. Let connection nodes drift slowly along paths only when reduced motion is not requested. Use opacity and transform only; avoid layout animation and excessive glow.

**Typography System:** Use Space Grotesk for headlines and labels, paired with DM Sans for body copy and controls. Headlines use tight tracking and strong weight contrast. Small labels use uppercase lettering with generous tracking. Body text stays between 15px and 18px for mobile readability.

**Brand Essence:** NIVO is a global human matching layer for people who need something and people who can provide it; it is distinct because it starts from mutual usefulness rather than feeds, followers, or listings.

**Personality Adjectives:** Precise, open, quietly ambitious.

**Brand Voice:** Headlines are direct and human. CTAs are active but never salesy. Microcopy is clear, warm, and transparent about what is real in the MVP. Avoid generic startup filler.

Example lines:

- “Put the need into words. Let the right person find it.”
- “Your capability is useful somewhere.”

**Wordmark & Logo:** Use the exact supplied NIVO logo asset as the official mark without altering its shape, adding text, or substituting an icon. Until the source image is available in the project assets, the implementation should reserve the logo placement and avoid inventing a replacement.

**Signature Brand Color:** Signal Cyan `#63E6FF`.

## MVP Product Scope

The first delivery will be a polished client-side prototype of the primary product loop: landing page, NEED/CAN creation, discover browsing, recommended matches, connection request modal, chat preview, profile preview, trust/safety affordances, and mobile bottom navigation. Interactions that require a backend will be represented as transparent prototype states rather than fabricated production claims.

## Style Decisions

- The first viewport must show a legible NEED → NIVO signal layer → CAN loop as the hero’s primary visual signature.
- Signal Cyan `#63E6FF` is reserved for primary actions, NEED/CAN emphasis, connection paths, nodes, and match states; it is not a general-purpose headline highlight.
- Network imagery should include human-intent cues wherever possible, including silhouettes, profile fragments, NEED/CAN cards, or connection paths.
- The official logo placement is framed as a deliberate brand anchor and remains ready for the exact user-supplied image asset; no replacement symbol is invented.
