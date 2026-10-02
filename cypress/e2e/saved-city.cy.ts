import type { Interception } from 'cypress/types/net-stubbing';
import { interceptUsno, waitForEvening } from '../support/usno';

const savedCity = {
  id: 5128581,
  name: 'Saved New York',
  region: 'New York',
  country: 'United States',
  countryCode: 'US',
  latitude: 40.7,
  longitude: -74,
  timezone: 'America/New_York',
};
const updatedCity = {
  ...savedCity,
  name: 'New York City',
  latitude: 40.71427,
  longitude: -74.00597,
};
const london = {
  id: 2643743,
  name: 'London',
  region: 'England',
  country: 'United Kingdom',
  countryCode: 'GB',
  latitude: 51.50853,
  longitude: -0.12574,
  timezone: 'Europe/London',
};

function openSavedCity(city = savedCity, now = Date.UTC(2026, 8, 13, 18)) {
  cy.clock(now, ['Date', 'setInterval', 'clearInterval']);
  interceptUsno({
    events: ['sunset', 'civil', 'nautical', 'astronomical'].map((kind) => ({
      kind,
      at: '2026-09-13T23:00:00.000Z',
      status: 'occurs',
    })),
  });
  cy.intercept('GET', '/api/uv?*', {
    status: 'outside-horizon',
    points: [],
    modelRun: null,
    retrievedAt: '2026-09-13T18:00:00Z',
    sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/',
  }).as('uv');
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('gloam.city.v1', JSON.stringify(city));
    },
  });
  waitForEvening();
  cy.wait('@uv');
  cy.get('[aria-label="Solar events"]').should('be.visible');
}

function holdLookup(city: unknown, statusCode = 200) {
  let release: () => void;
  cy.intercept(
    'GET',
    `/api/cities?id=${savedCity.id}`,
    (request) =>
      new Promise<void>((resolve) => {
        release = () => {
          request.reply({ statusCode, body: { city } });
          resolve();
        };
      }),
  ).as('cityLookup');
  return () => cy.then(() => release());
}

function expectStoredCity(city: typeof savedCity) {
  cy.window().should((win) => {
    expect(JSON.parse(win.localStorage.getItem('gloam.city.v1')!)).to.deep.equal(city);
  });
}

describe('Saved city updates', () => {
  it('shows the saved city immediately and refreshes its coordinates without changing a planned date', () => {
    const release = holdLookup(updatedCity);
    openSavedCity();
    cy.get('h1').should('have.text', savedCity.name);
    cy.get('input[type="date"]').invoke('val', '2027-01-01').trigger('change', { force: true });
    waitForEvening();
    cy.wait('@uv');
    release();
    cy.wait('@cityLookup');
    waitForEvening();
    cy.get('@evening.all').then((interceptions) => {
      const queries = (interceptions as unknown as Interception[])
        .slice(-4)
        .map(({ request }) => new URL(request.url).searchParams);
      queries.forEach((query) => {
        expect(query.get('lat')).to.equal(updatedCity.latitude.toFixed(4));
        expect(query.get('lon')).to.equal(updatedCity.longitude.toFixed(4));
        expect(query.get('year')).to.equal('2027');
      });
    });
    cy.wait('@uv').then(({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get('latitude')).to.equal(String(updatedCity.latitude));
      expect(query.get('longitude')).to.equal(String(updatedCity.longitude));
      expect(query.get('date')).to.equal('2027-01-01');
    });
    cy.get('h1').should('have.text', updatedCity.name);
    cy.get('input[type="date"]').should('have.value', '2027-01-01');
    expectStoredCity(updatedCity);
  });

  it('uses a corrected time zone while continuing to follow the current local day', () => {
    const correctedCity = { ...updatedCity, timezone: 'America/Los_Angeles' };
    const release = holdLookup(correctedCity);
    openSavedCity(savedCity, Date.parse('2026-09-14T05:00:00Z'));
    cy.get('input[type="date"]').should('have.value', '2026-09-14');
    release();
    cy.wait('@cityLookup');
    waitForEvening();
    cy.wait('@uv').then(({ request }) => {
      const query = new URL(request.url).searchParams;
      expect(query.get('timezone')).to.equal(correctedCity.timezone);
      expect(query.get('date')).to.equal('2026-09-13');
    });
    cy.get('.timezone-label').should('contain.text', 'Pacific Daylight Time (UTC−07:00)');
    cy.get('input[type="date"]').should('have.value', '2026-09-13');
    expectStoredCity(correctedCity);
  });

  it('does not overwrite a city selected while the saved-city lookup is in flight', () => {
    const release = holdLookup(updatedCity);
    openSavedCity();
    cy.intercept('GET', '/api/cities?q=*', { cities: [london] }).as('citySearch');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('input[aria-label="Search cities"]').type('London');
    cy.wait('@citySearch');
    cy.contains('.results button', 'England, United Kingdom').click();
    waitForEvening();
    cy.wait('@uv');
    release();
    cy.wait('@cityLookup');
    cy.get('h1').should('have.text', london.name);
    expectStoredCity(london);
    cy.get('@evening.all').should('have.length', 8);
  });

  for (const [description, city, statusCode] of [
    ['a missing record', null, 200],
    ['a failed request', null, 503],
    ['an invalid record', { ...updatedCity, timezone: 'Invalid/Zone' }, 200],
    ['a different city ID', london, 200],
    ['an unchanged record', savedCity, 200],
  ] as const) {
    it(`keeps the saved city and loaded events after ${description}`, () => {
      const release = holdLookup(city, statusCode);
      openSavedCity();
      release();
      cy.wait('@cityLookup');
      cy.get('h1').should('have.text', savedCity.name);
      cy.get('[aria-label="Solar events"]').should('be.visible');
      expectStoredCity(savedCity);
      cy.get('@evening.all').should('have.length', 4);
    });
  }

  it('does not look up an estimated location without a GeoNames ID', () => {
    cy.intercept('GET', '/api/cities?id=*', { city: null }).as('cityLookup');
    openSavedCity({ ...savedCity, id: 0 });
    cy.get('@cityLookup.all').should('have.length', 0);
    cy.get('h1').should('have.text', savedCity.name);
  });
});
