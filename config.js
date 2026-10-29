// Public connection details. These are web addresses, not secrets: the database's row-level security is what protects the data.
// Never put a password, secret key or connection string in this file.
export const CONFIG = {
  authUrl: 'https://ep-misty-recipe-zake4pt1.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth',          // Neon Auth (sign in)
  apiUrl: 'https://ep-misty-recipe-zake4pt1.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1',         // Neon Data API (records)
  appName: 'AD Investment CRM',     // shown in the page title and on the sign-in screen
  // Branding for the sign-in screen, which appears before we know who is signing in.
  // After sign-in the organisation's own brand (organisations.brand in the database) takes over.
  brand: {
    name: 'Alchemy Drinks',
    logoUrl: 'https://alchemydrinks.co.uk/wp-content/uploads/2024/08/Screenshot-2024-08-02-at-15.51.13.png',
  },
};
