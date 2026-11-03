/**
 * Seeded, deliberately broken sample pages.
 *
 * The demo must never depend on a live fetch, so Remedy ships with
 * three realistic pages that between them exercise most of the rule
 * engine: a café page, a checkout form, and a community article.
 * Every violation in them is intentional demo material.
 */

export interface SamplePage {
  id: string;
  name: string;
  description: string;
  html: string;
}

const CAFE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Georgia, serif; color: #333333; background-color: #ffffff; }
  .special-note { color: #b8b8b8; font-size: 13px; }
  .order-btn { background-color: #2f5d34; color: #ffffff; }
</style>
</head>
<body>
  <header>
    <img src="/images/juniper-cafe-logo.png">
    <h1>Juniper Café</h1>
    <p class="special-note">Now serving weekend brunch until 2 PM — ask about the patio.</p>
  </header>
  <main>
    <h3>Today's Specials</h3>
    <p>Roasted tomato soup, grilled sourdough, and the last of the summer peaches.</p>
    <figure>
      <img src="/images/tomato-soup.jpg">
      <figcaption>Roasted tomato soup with basil oil</figcaption>
    </figure>
    <a href="/menu"><img src="/images/menu-card.jpg"></a>
    <p id="note">Gift cards are available at the counter.</p>
    <p id="note">We cater small events — ask us anything.</p>
    <button class="order-btn"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#ffffff"/></svg></button>
  </main>
</body>
</html>
`;

const CHECKOUT = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Checkout — Northwind Outfitters</title>
<style>
  body { font-family: Arial, sans-serif; color: #222222; background-color: #ffffff; }
  .hint { color: #a3a3a3; font-size: 12px; }
  .pay-btn { background-color: #1d4ed8; color: #ffffff; font-size: 16px; }
</style>
</head>
<body>
  <h1>Checkout</h1>
  <p class="hint">All fields are required. Your card is charged when the order ships.</p>
  <form>
    <input type="text" name="full-name" placeholder="Full name" tabindex="3">
    <input type="email" name="email" placeholder="Email address" tabindex="1">
    <input type="text" name="card" placeholder="Card number" tabindex="2">
    <select name="state">
      <option>Texas</option>
      <option>Oklahoma</option>
    </select>
    <button class="pay-btn" type="submit">Pay now</button>
  </form>
  <h2>Order summary</h2>
  <table>
    <tr><td>Item</td><td>Qty</td><td>Price</td></tr>
    <tr><td>Trail boots</td><td>1</td><td>$129.00</td></tr>
    <tr><td>Wool socks</td><td>2</td><td>$24.00</td></tr>
  </table>
  <iframe src="https://maps.example.com/store-locator" width="100%" height="240"></iframe>
</body>
</html>
`;

const ARTICLE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title></title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; background-color: #ffffff; }
  .byline { color: #9a9a9a; font-size: 14px; }
  .caption { color: #8f8f8f; font-size: 12px; }
</style>
</head>
<body>
  <article>
    <h1>Library Board Approves Weekend Hours</h1>
    <p class="byline">By Dana Ruiz — October 28, 2026</p>
    <img src="/photos/library-steps-2026.jpg" alt="library-steps-2026.jpg">
    <p class="caption">The main branch on Elm Street, photographed Tuesday morning.</p>
    <h2>What changed</h2>
    <p>Saturday hours extend to 8 PM starting in November. Sunday hours are unchanged.</p>
    <h4>Programs affected</h4>
    <p>The children's reading circle moves to the community room. The evening ESL class keeps its slot.</p>
    <h3></h3>
    <p>Residents can comment at the November meeting or through the library website.</p>
    <a href="/documents/board-minutes-october.pdf"></a>
  </article>
</body>
</html>
`;

export const SAMPLES: SamplePage[] = [
  {
    id: "cafe",
    name: "Juniper Café — homepage",
    description:
      "A small café page: undeclared language, no title, images without alt text, a skipped heading level, low-contrast note text, duplicate ids, and an unnamed icon button.",
    html: CAFE,
  },
  {
    id: "checkout",
    name: "Northwind Outfitters — checkout",
    description:
      "A checkout form: unlabelled fields, positive tabindex, zoom disabled in the viewport, a data table with no header cells, and an untitled embedded map.",
    html: CHECKOUT,
  },
  {
    id: "article",
    name: "Community news — library article",
    description:
      "A news article: undeclared language, an empty title and an empty heading, file-name alt text, low-contrast byline and caption, a skipped heading level, and an empty PDF link.",
    html: ARTICLE,
  },
];

export function getSample(id: string): SamplePage | undefined {
  return SAMPLES.find((s) => s.id === id);
}
