import 'cypress-axe';

beforeEach(() => {
  // Keep fixtures stable when the production city catalog receives an update.
  cy.intercept('GET', '/api/cities?id=*', { city: null });
});
