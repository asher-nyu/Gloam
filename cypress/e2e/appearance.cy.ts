import { interceptUsno, waitForEvening } from '../support/usno';

const newYork = {
  id: 5128581,
  name: 'New York City',
  region: 'New York',
  country: 'United States',
  countryCode: 'US',
  latitude: 40.71427,
  longitude: -74.00597,
  timezone: 'America/New_York',
};
const london = {
  ...newYork,
  id: 2643743,
  name: 'London',
  region: 'England',
  country: 'United Kingdom',
  countryCode: 'GB',
  latitude: 51.50853,
  longitude: -0.12574,
  timezone: 'Europe/London',
};
const evening = {
  date: '2026-09-13',
  events: [
    { kind: 'sunset', at: '2026-09-13T23:08:00.000Z' as string | null, status: 'occurs' },
    { kind: 'civil', at: '2026-09-13T23:36:00.000Z' as string | null, status: 'occurs' },
    { kind: 'nautical', at: '2026-09-14T00:08:00.000Z' as string | null, status: 'occurs' },
    { kind: 'astronomical', at: '2026-09-14T00:41:00.000Z' as string | null, status: 'occurs' },
  ],
  source: 'USNO',
  sourceUrl: 'https://aa.usno.navy.mil/data/RS_OneYear',
  retrievedAt: '2026-09-13T18:00:00Z',
};
const forecast = {
  status: 'available',
  points: [2.4, 0.9, 0.2, 0, 0, 0, 0, 0].map((index, i) => ({
    at: new Date(Date.UTC(2026, 8, 13, 20 + i)).toISOString(),
    index: index as number | null,
  })),
  modelRun: '2026-09-13T12:00:00Z',
  sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/',
  retrievedAt: '2026-09-13T18:00:00Z',
};
const palettes = {
  light: {
    canvas: 'rgb(245, 245, 247)',
    surface: 'rgb(255, 255, 255)',
    dialog: 'rgb(255, 255, 255)',
    ink: 'rgb(32, 33, 43)',
    themeColor: '#f5f5f7',
  },
  dark: {
    canvas: 'rgb(16, 16, 18)',
    surface: 'rgb(28, 28, 30)',
    dialog: 'rgb(36, 36, 38)',
    ink: 'rgb(245, 245, 247)',
    themeColor: '#101012',
  },
};
type Appearance = keyof typeof palettes;

function setSystemAppearance(appearance?: Appearance) {
  // Emulate the browser's OS preference; do not mutate application CSS or application state.
  return cy.then(() =>
    Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setEmulatedMedia',
      params: {
        features: appearance ? [{ name: 'prefers-color-scheme', value: appearance }] : [],
      },
    }),
  );
}

function openPlanner(
  appearance: Appearance,
  { template = evening, uv = forecast }: { template?: typeof evening; uv?: typeof forecast } = {},
) {
  setSystemAppearance(appearance);
  // Keep debounce timeouts real while making the displayed date and clock deterministic.
  cy.clock(Date.UTC(2026, 8, 13, 18), ['Date', 'setInterval', 'clearInterval']);
  // Keep the London fixture's sunset within its local day while later phases cross midnight.
  interceptUsno(template, 'appearanceEvening', {
    [london.latitude.toFixed(4)]: {
      ...template,
      events: template.events.map((event) =>
        event.kind === 'sunset' ? { ...event, at: '2026-09-13T20:08:00.000Z' } : event,
      ),
    },
  });
  cy.intercept('GET', '/api/uv?*', uv).as('appearanceUv');
  cy.intercept('GET', '/api/cities?q=*', (req) => {
    const query = new URL(req.url).searchParams.get('q')!.toLowerCase();
    req.reply({ cities: query.includes('london') ? [london] : [newYork] });
  }).as('appearanceCities');
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.clear();
      win.localStorage.setItem('gloam.city.v1', JSON.stringify(newYork));
    },
  });
  waitForEvening('appearanceEvening');
  cy.wait('@appearanceUv');
  cy.get('.evening-card .event').should('have.length', 4);
}

function expectAppearance(appearance: Appearance) {
  const palette = palettes[appearance];
  cy.title().should('eq', 'Gloam');
  cy.window().should((win) => {
    expect(win.matchMedia(`(prefers-color-scheme: ${appearance})`).matches).to.equal(true);
    const style = win.getComputedStyle(win.document.documentElement);
    expect(style.backgroundColor, 'document canvas').to.equal(palette.canvas);
    expect(style.color, 'inherited text').to.equal(palette.ink);
    expect(style.colorScheme, 'native controls support the active system appearance').to.contain(
      appearance,
    );
  });
  cy.get('.evening-card, .uv-card').each(($card) => {
    cy.wrap($card).should('have.css', 'background-color', palette.surface);
  });
  cy.get('input[type="date"]').each(($control) => {
    cy.wrap($control).should('have.css', 'color-scheme').and('contain', appearance);
  });
  cy.get('select[aria-label="Display time zone"], .timezone-picker, .zone-notice').should(
    'not.exist',
  );
  cy.get('.timezone-label').should('be.visible').and('contain.text', 'Time zone');
}

function checkAccessibility() {
  cy.checkA11y(undefined, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
  });
}

function expectNoOverflow(width: number) {
  cy.document().should((doc) => {
    expect(doc.documentElement.scrollWidth, 'page width').to.be.lte(width);
  });
}

function contrastRatio(first: string, second: string) {
  const luminance = (color: string) => {
    const values = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    return values.reduce((sum, value, index) => {
      const channel = value / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index];
    }, 0);
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function expectVisibleForecastBars() {
  cy.get('.uv-hours .bar')
    .first()
    .should(($bar) => {
      const bar = $bar[0];
      const win = bar.ownerDocument.defaultView!;
      const foreground = win.getComputedStyle(bar).backgroundColor;
      const background = win.getComputedStyle(bar.closest('.uv-card')!).backgroundColor;
      expect(contrastRatio(foreground, background), 'UV bars against their card').to.be.at.least(3);
    });
}

describe('System appearance', { browser: { family: 'chromium' } }, () => {
  afterEach(() => {
    setSystemAppearance();
  });

  it('opens in system dark mode with matching brand assets and browser chrome', () => {
    cy.viewport(1440, 1000);
    openPlanner('dark');
    expectAppearance('dark');
    expectNoOverflow(1440);
    expectVisibleForecastBars();
    cy.get('meta[name="color-scheme"]').should('have.attr', 'content', 'light dark');
    for (const appearance of ['light', 'dark'] as const) {
      cy.get(`meta[name="theme-color"][media="(prefers-color-scheme: ${appearance})"]`).should(
        'have.attr',
        'content',
        palettes[appearance].themeColor,
      );
    }
    cy.get('link[rel="icon"]')
      .invoke('prop', 'href')
      .then((href) => {
        cy.get('.brand img').invoke('prop', 'src').should('equal', href);
        cy.request<string>(href)
          .its('body')
          .should('match', /prefers-color-scheme:\s*dark/);
      });
    cy.get('button, [role="switch"]').each(($button) => {
      const label = `${$button.text()} ${$button.attr('aria-label') ?? ''}`;
      expect(label).not.to.match(/appearance|dark mode|light mode|switch theme/i);
    });
    cy.get('.countdown, [role="timer"]').should('not.exist');
    cy.window().then((win) => {
      expect(Object.keys(win.localStorage)).to.deep.equal(['gloam.city.v1']);
    });
    cy.injectAxe();
    checkAccessibility();
    cy.screenshot('gloam-system-dark-1440', { capture: 'fullPage' });
  });

  it('opens in system light mode and adapts a narrow page without changing layout', () => {
    cy.viewport(320, 844);
    openPlanner('light');
    expectAppearance('light');
    expectNoOverflow(320);
    expectVisibleForecastBars();
    cy.injectAxe();
    checkAccessibility();
    let initialRows: number[];
    cy.get('.event').then(($events) => {
      initialRows = [...$events].map((event) => event.getBoundingClientRect().height);
    });
    setSystemAppearance('dark');
    expectAppearance('dark');
    expectNoOverflow(320);
    cy.get('.event').should(($events) => {
      expect([...$events].map((event) => event.getBoundingClientRect().height)).to.deep.equal(
        initialRows,
      );
    });
    checkAccessibility();
    cy.screenshot('gloam-system-dark-320', { capture: 'fullPage' });
    cy.document().then((doc) => {
      doc.documentElement.style.fontSize = '200%';
    });
    expectNoOverflow(320);
    checkAccessibility();
  });

  it('preserves the selected city’s local time, future date, and open search through live system changes', () => {
    openPlanner('dark');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('[aria-label="Search cities"]').type('London', { delay: 0 });
    cy.wait('@appearanceCities');
    cy.contains('.results button', 'London').click();
    waitForEvening('appearanceEvening');
    cy.wait('@appearanceUv');
    cy.get('h1').should('have.text', 'London');
    cy.get('.city-clock .clock-digits').should('have.text', '7:00:00');
    cy.get('input[type="date"]').invoke('val', '2026-09-20').trigger('change', { force: true });
    waitForEvening('appearanceEvening');
    cy.wait('@appearanceUv');
    cy.get('.timezone-label').should('contain.text', 'British Summer Time (UTC+01:00)');
    cy.get('.event').last().find('.offset').should('have.text', 'Next day');
    cy.get('.event').last().find('.digits').should('have.text', '1:41');
    cy.injectAxe();
    checkAccessibility();
    cy.get('[aria-label^="Change city"]').click();
    cy.get('[aria-label="Search cities"]').type('New York', { delay: 0 });
    cy.wait('@appearanceCities');
    cy.contains('.results button', 'New York City').should('be.visible');
    let originalDocument: Document;
    cy.document().then((doc) => {
      originalDocument = doc;
    });
    for (const appearance of ['light', 'dark'] as const) {
      setSystemAppearance(appearance);
      expectAppearance(appearance);
      cy.document().should((doc) => expect(doc).to.equal(originalDocument));
      cy.get('h1').should('have.text', 'London');
      cy.get('input[type="date"]').should('have.value', '2026-09-20');
      cy.get('.timezone-label').should('contain.text', 'British Summer Time (UTC+01:00)');
      cy.get('.city-clock .clock-digits').should('have.text', '7:00:00');
      cy.get('.dialog-content')
        .should('be.visible')
        .and('have.css', 'background-color', palettes[appearance].dialog);
      cy.get('[aria-label="Search cities"]').should('have.value', 'New York').and('have.focus');
      cy.contains('.results button', 'New York City').should('be.visible');
      checkAccessibility();
    }
    cy.screenshot('gloam-system-dark-city-search', { capture: 'viewport' });
    cy.get('[aria-label="Search cities"]').type('{esc}');
    cy.get('.dialog-content, .dialog-overlay').should('not.exist');
    cy.focused().should('have.attr', 'aria-label', 'Change city, currently London');
    setSystemAppearance('light');
    expectAppearance('light');
    checkAccessibility();
  });

  it('updates an open About dialog and restores focus in both appearances', () => {
    openPlanner('light');
    cy.injectAxe();
    cy.contains('button', 'About the data').click();
    for (const appearance of ['light', 'dark'] as const) {
      setSystemAppearance(appearance);
      expectAppearance(appearance);
      cy.get('.dialog-content')
        .should('be.visible')
        .and('have.css', 'background-color', palettes[appearance].dialog);
      cy.get('.about-copy').should('contain.text', 'U.S. Naval Observatory');
      checkAccessibility();
    }
    cy.get('[aria-label="Close about the data"]').click();
    cy.get('.dialog-content, .dialog-overlay').should('not.exist');
    cy.focused().should('contain.text', 'About the data');
    setSystemAppearance('light');
    expectAppearance('light');
    cy.focused().should('contain.text', 'About the data');
    checkAccessibility();
  });

  it('keeps missing events, partial readings, and unavailable forecasts legible in both appearances', () => {
    openPlanner('dark', {
      template: {
        ...evening,
        events: evening.events.map((event) =>
          event.kind === 'astronomical' ? { ...event, at: null, status: 'unavailable' } : event,
        ),
      },
      uv: {
        ...forecast,
        status: 'partial',
        points: forecast.points.map((point, index) =>
          index === 1 ? { ...point, index: null } : point,
        ),
      },
    });
    cy.injectAxe();
    for (const appearance of ['dark', 'light'] as const) {
      setSystemAppearance(appearance);
      expectAppearance(appearance);
      cy.get('.event').last().find('.missing').should('have.text', 'Unavailable');
      cy.get('.uv-hours .hour-value').eq(1).should('contain.text', 'unavailable');
      cy.get('.uv-hours .hour-value').eq(3).should('contain.text', '0.0');
      checkAccessibility();
    }
    cy.intercept('GET', '/api/uv?*', { ...forecast, status: 'outside-horizon', points: [] }).as(
      'outsideHorizon',
    );
    cy.get('[aria-label="Next evening"]').click();
    waitForEvening('appearanceEvening');
    cy.wait('@outsideHorizon');
    for (const appearance of ['light', 'dark'] as const) {
      setSystemAppearance(appearance);
      expectAppearance(appearance);
      cy.contains('.uv-card h3', 'Forecast not available for this date').should('be.visible');
      cy.get('.uv-hours').should('not.exist');
      checkAccessibility();
    }
  });
});
