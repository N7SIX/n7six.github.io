Armel FAUVEAU

GLOBALIS Ⓖ co-founder/CTO

Web, Security, Performance, Apple  Addict, Geek Life, Astronomy, Ham Radio Operator F4HWN & RRF Admin, Nature, Fly Fishing and more.


# n7six.github.io

## Setup

1. **Install Ruby and Bundler:**
	- `gem install bundler`
2. **Install Jekyll dependencies:**
	- `bundle install`
3. **Install Node.js dependencies:**
	- `npm install`

## Local Development

Build and serve the site locally:

```sh
bundle exec jekyll serve
```

## Linting and Formatting

- Lint JS: `npm run lint:js`
- Lint CSS: `npm run lint:css`
- Format: `npm run format`

## Testing

Run basic JS tests:

```sh
npx mocha test/*.test.js
```

## Build for Production

```sh
JEKYLL_ENV=production bundle exec jekyll build --config _config.yml,_config.production.yml
```

## Deployment

Deploys automatically via GitHub Actions to GitHub Pages on push to `main`.

## Updating Dependencies

- Ruby gems: `bundle update`
- Node packages: `npm update`

## Folder Structure

- `_posts/` — Blog posts
- `_layouts/` — Jekyll layouts
- `css/`, `js/`, `images/` — Static assets
- `test/` — JS tests

## Security & Best Practices

- Uses `jekyll-seo-tag` for SEO
- Excludes dev files from production build
- Lints and tests on every push via CI