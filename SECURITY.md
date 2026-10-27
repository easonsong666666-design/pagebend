# Security and privacy

PageBend visits the URL you supply in a fresh Playwright browser context and temporarily changes the rendered DOM. It does not change your source files or submit forms. The page itself still runs JavaScript and makes its normal network requests; visiting a URL is not a sandbox for hostile websites.

`--storage-state` opts into using your existing Playwright session locally. Treat that file as a credential. Never check it in. PageBend does not write the state into its report. Starting with 0.1.2, authentication state initialization failures use a fixed recovery message so parser and validation errors cannot quote credentials. Older releases could include fragments of malformed state files in failed-scan reports; review those reports before sharing them.

Reports contain screenshots, selectors and visible page text. URL query strings and fragments are removed from the displayed URL, but screenshots may still contain private information. Review reports before publishing them. The generated report needs no server, telemetry, external scripts or fonts.

For a security issue, use GitHub's private vulnerability reporting on this repository if available. Do not post credential-containing reports in a public issue.
