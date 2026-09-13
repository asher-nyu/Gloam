const city = {
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
  id: 2643743,
  name: 'London',
  region: 'England',
  country: 'United Kingdom',
  countryCode: 'GB',
  latitude: 51.50853,
  longitude: -0.12574,
  timezone: 'Europe/London',
};
const losAngeles = {
  id: 5368361,
  name: 'Los Angeles',
  region: 'California',
  country: 'United States',
  countryCode: 'US',
  latitude: 34.05223,
  longitude: -118.24368,
  timezone: 'America/Los_Angeles',
};
const stockholm = {
  id: 2673730,
  name: 'Stockholm',
  region: 'Stockholm',
  country: 'Sweden',
  countryCode: 'SE',
  latitude: 59.32938,
  longitude: 18.06871,
  timezone: 'Europe/Stockholm',
};
const sydney = {
  id: 2147714,
  name: 'Sydney',
  region: 'New South Wales',
  country: 'Australia',
  countryCode: 'AU',
  latitude: -33.86785,
  longitude: 151.20732,
  timezone: 'Australia/Sydney',
};
const evening = {
  date: '2026-09-13',
  events: [
    { kind: 'sunset', at: '2026-09-13T23:08:00.000Z', status: 'occurs' },
    { kind: 'civil', at: '2026-09-13T23:36:00.000Z', status: 'occurs' },
    { kind: 'nautical', at: '2026-09-14T00:08:00.000Z', status: 'occurs' },
    { kind: 'astronomical', at: '2026-09-14T00:41:00.000Z', status: 'occurs' },
  ],
  source: 'USNO',
  sourceUrl: 'https://aa.usno.navy.mil/data/RS_OneYear',
  retrievedAt: '2026-09-13T18:00:00Z',
};
const forecast = {
  status: 'available',
  points: [2.4, 0.9, 0.2, 0, 0, 0, 0, 0].map((index, i) => ({
    at: new Date(Date.UTC(2026, 8, 13, 20 + i)).toISOString(),
    index,
  })),
  modelRun: '2026-09-13T12:00:00Z',
  sourceUrl: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/uvi/prod/',
  retrievedAt: '2026-09-13T18:00:00Z',
};

function eveningForDate(date: string, template = evening) {
  const offset = Date.parse(`${date}T00:00:00Z`) - Date.parse(`${template.date}T00:00:00Z`);
  const shift = (at: string) => new Date(Date.parse(at) + offset).toISOString();
  return {
    ...template,
    date,
    events: template.events.map((event) => ({ ...event, at: shift(event.at) })),
  };
}

function openPlanner({
  now = Date.UTC(2026, 8, 13, 18),
  selectedCity = city,
  template = evening,
}: { now?: number; selectedCity?: typeof city; template?: typeof evening } = {}) {
  // Leave timeouts real so city-search debounce and request handling still run normally.
  cy.clock(now, ['Date', 'setInterval', 'clearInterval']);
  cy.intercept('GET', '/api/evening?*', (req) => {
    const date = new URL(req.url).searchParams.get('date')!;
    req.reply(eveningForDate(date, template));
  }).as('evening');
  cy.intercept('GET', '/api/uv?*', forecast).as('uv');
  cy.visit('/', {
    onBeforeLoad(win) {
      win.localStorage.setItem('gloam.city.v1', JSON.stringify(selectedCity));
    },
  });
  cy.wait('@evening');
  cy.wait('@uv');
  cy.get('[aria-label="Solar events"]').should('be.visible');
  cy.get('.timezone-label').should('be.visible').and('contain.text', 'Time zone');
  cy.title().should('eq', 'Gloam');
}

function expectStaticEvents() {
  const labels = [
    'Sunset',
    'Civil twilight ends',
    'Nautical twilight ends',
    'Astronomical twilight ends',
  ];
  const definitions = [/upper edge|civil twilight begins/i, /6°/, /12°/, /18°/];
  cy.get('.evening-card').within(() => {
    cy.get('.event').should('have.length', 4);
    cy.get('.event-time').should('have.length', 4);
    cy.get('button, [aria-pressed], [role="timer"]').should('not.exist');
    cy.get('.countdown, .phase-bands, .timeline-overview, .phase-detail, .hero-grid').should(
      'not.exist',
    );
    labels.forEach((label, index) => {
      cy.get('.event')
        .eq(index)
        .within(() => {
          cy.get('h3.event-label').should('have.text', label);
          cy.get('.event-description')
            .should('be.visible')
            .invoke('text')
            .should('match', definitions[index]);
          cy.get('.boundary-time .event-time').should('have.length', 1).and('be.visible');
        });
    });
    cy.get('.boundary-time .digits').should((digits) => {
      expect([...digits].map((digit) => digit.textContent?.trim())).to.deep.equal([
        '7:08',
        '7:36',
        '8:08',
        '8:41',
      ]);
    });
  });
}

function firstLineBaseline(element: Element) {
  // A zero-size inline block exposes the text baseline without assuming equal font sizes.
  const probe = element.ownerDocument.createElement('span');
  probe.style.cssText =
    'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline;';
  element.prepend(probe);
  try {
    return probe.getBoundingClientRect().top;
  } finally {
    probe.remove();
  }
}

describe('Evening planner', () => {
  it('advances the current clock with real browser timers', () => {
    cy.intercept('GET', '/api/evening?*', (req) => {
      req.reply(eveningForDate(new URL(req.url).searchParams.get('date')!));
    }).as('realEvening');
    cy.intercept('GET', '/api/uv?*', forecast).as('realUv');
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.setItem('gloam.city.v1', JSON.stringify(city));
      },
    });
    cy.wait('@realEvening');
    cy.wait('@realUv');
    cy.get('.city-clock time')
      .invoke('attr', 'datetime')
      .then((initial) => {
        const initialTime = Date.parse(initial!);
        cy.get('.city-clock time', { timeout: 5000 }).should((clock) => {
          expect(Date.parse(clock.attr('datetime')!) - initialTime).to.be.at.least(1000);
        });
      });
  });
  it('automatically uses the selected city’s local time for the clock, events, and UV forecast', () => {
    openPlanner();
    cy.get('select[aria-label="Display time zone"], .timezone-picker, .zone-notice').should(
      'not.exist',
    );
    cy.get('.timezone-label').should('contain.text', 'Eastern Daylight Time (UTC−04:00)');
    cy.get('.city-clock .clock-digits').should('have.text', '2:00:00');
    cy.get('.event').last().find('.digits').should('have.text', '8:41');
    cy.get('.uv-hours .hour-time')
      .first()
      .invoke('text')
      .should('match', /4\s*PM/);
    cy.intercept('GET', '/api/cities?q=*', { cities: [london] }).as('londonSearch');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('input[aria-label="Search cities"]').type('London');
    cy.wait('@londonSearch');
    cy.contains('.results button', 'England, United Kingdom').click();
    for (const request of ['@evening', '@uv']) {
      cy.wait(request).then(({ request }) => {
        const query = new URL(request.url).searchParams;
        expect(query.get('timezone')).to.equal(london.timezone);
        expect(query.get('latitude')).to.equal(String(london.latitude));
        expect(query.get('longitude')).to.equal(String(london.longitude));
      });
    }
    cy.get('h1').should('have.text', 'London');
    cy.title().should('eq', 'Gloam');
    cy.get('.dialog-content').should('not.exist');
    cy.get('.dialog-overlay').should('not.exist');
    cy.get('.timezone-label').should('contain.text', 'British Summer Time (UTC+01:00)');
    cy.get('.city-clock .clock-digits').should('have.text', '7:00:00');
    cy.get('.event').last().find('.digits').should('have.text', '1:41');
    cy.get('.event').last().find('.offset').should('be.visible').and('have.text', 'Next day');
    cy.get('.uv-hours .hour-time')
      .first()
      .invoke('text')
      .should('match', /9\s*PM/);
    cy.get('.uv-footer').should('contain.text', '1:00 PM GMT+1');
    cy.get('select').should('not.exist');
    cy.reload();
    cy.wait('@evening');
    cy.wait('@uv');
    cy.get('h1').should('have.text', 'London');
    cy.get('.timezone-label').should('contain.text', 'British Summer Time (UTC+01:00)');
    cy.get('.city-clock .clock-digits').should('have.text', '7:00:00');
    cy.get('select').should('not.exist');
    cy.title().should('eq', 'Gloam');
  });
  it('supports tomorrow and future dates without treating missing UV as zero', () => {
    openPlanner();
    cy.contains('button', /^Today$/).should('not.exist');
    cy.get('[aria-label="Next evening"]').click();
    cy.get('input[type="date"]').should('have.value', '2026-09-14');
    cy.contains('button', /^Today$/).click();
    cy.get('input[type="date"]').should('have.value', '2026-09-13');
    cy.contains('button', /^Today$/).should('not.exist');
    cy.intercept('GET', '/api/uv?*', { ...forecast, status: 'outside-horizon', points: [] });
    cy.get('input[type="date"]').invoke('val', '2027-01-01').trigger('change', { force: true });
    cy.contains('Forecast not available for this date').should('be.visible');
    cy.get('.uv-hours, .hour-value').should('not.exist');
  });
  for (const [period, at] of [
    ['daytime', '2026-09-13T18:00:00Z'],
    ['twilight', '2026-09-13T23:40:00Z'],
    ['night', '2026-09-14T02:00:00Z'],
  ]) {
    it(`shows each event time and its meaning once during ${period}`, () => {
      openPlanner({ now: Date.parse(at) });
      expectStaticEvents();
      cy.get('.clock-date').should('not.exist');
      cy.get('.date-picker').should('contain.text', 'Sun, Sep 13, 2026');
      cy.tick(1000);
      expectStaticEvents();
    });
  }
  it('shows the same static event format for a future planning date', () => {
    openPlanner();
    cy.get('input[type="date"]').invoke('val', '2026-09-20').trigger('change', { force: true });
    cy.wait('@evening');
    expectStaticEvents();
    cy.get('.date-picker').should('contain.text', 'Sun, Sep 20, 2026');
    cy.get('.clock-date').should('contain.text', 'Sep 13, 2026');
    cy.contains('button', /^Today$/).should('be.visible');
  });
  it('advances the planning date at the city’s midnight while following today', () => {
    openPlanner({ now: Date.parse('2026-09-14T03:59:59Z') });
    cy.get('input[type="date"]').should('have.value', '2026-09-13');
    cy.get('.clock-digits').should('have.text', '11:59:59');
    cy.get('.clock-date').should('not.exist');
    cy.tick(1000);
    cy.wait('@evening');
    cy.get('input[type="date"]').should('have.value', '2026-09-14');
    cy.get('.date-picker').should('contain.text', 'Mon, Sep 14, 2026');
    cy.get('.clock-digits').should('have.text', '12:00:00');
    cy.get('.clock-date').should('not.exist');
    cy.contains('button', /^Today$/).should('not.exist');
    expectStaticEvents();
  });
  it('keeps the current city clock independent of the planning date and labels seasonal local time', () => {
    openPlanner({ now: Date.parse('2026-09-13T23:30:30Z') });
    cy.get('.city-clock .clock-digits').should('have.text', '7:30:30');
    cy.get('.city-clock .clock-date').should('not.exist');
    cy.get('.city-clock .clock-label').should('have.text', 'Current time');
    cy.get('.timezone-label').should('contain.text', 'Eastern Daylight Time (UTC−04:00)');
    cy.get('.city-clock time').should('have.attr', 'datetime', '2026-09-13T23:30:30.000Z');
    cy.get('input[type="date"]').should('have.value', '2026-09-13');
    cy.get('input[type="date"]').invoke('val', '2027-01-01').trigger('change', { force: true });
    cy.wait('@evening');
    cy.get('.evening-card .event-time').should('have.length', 4);
    cy.get('.countdown, [role="timer"]').should('not.exist');
    cy.get('.city-clock .clock-date').should('contain.text', 'Sep 13, 2026');
    cy.get('.city-clock .clock-digits').should('have.text', '7:30:30');
    cy.get('.timezone-label').should('contain.text', 'Eastern Standard Time (UTC−05:00)');
    cy.title().should('eq', 'Gloam');
    cy.tick(1000);
    cy.get('.city-clock .clock-digits').should('have.text', '7:30:31');
    cy.get('input[type="date"]').should('have.value', '2027-01-01');
    cy.contains('button', /^Today$/).click();
    cy.wait('@evening');
    cy.get('.city-clock .clock-digits').should('have.text', '7:30:31');
    cy.get('.city-clock .clock-date').should('not.exist');
    cy.get('.city-clock .clock-label').should('have.text', 'Current time');
    cy.get('.timezone-label').should('contain.text', 'Eastern Daylight Time (UTC−04:00)');
    cy.get('input[type="date"]').should('have.value', '2026-09-13');
    cy.get('select').should('not.exist');
  });
  it('updates the footer year from the selected city’s current date and links to Asher', () => {
    openPlanner({
      now: Date.parse('2026-12-31T23:59:59Z'),
      selectedCity: london,
    });
    cy.get('footer').should('contain.text', '2026');
    cy.contains('footer a', 'Asher').should('have.attr', 'href', 'https://asher-nyu.com');
    cy.get('input[type="date"]').invoke('val', '2027-01-02').trigger('change', { force: true });
    cy.wait('@evening');
    cy.get('footer').should('contain.text', '2026');
    cy.tick(1000);
    cy.get('footer').should('contain.text', '2027');
    cy.get('.clock-date').should('contain.text', 'Jan 1, 2027');
    cy.get('input[type="date"]').should('have.value', '2027-01-02');
    cy.intercept('GET', '/api/cities?q=*', { cities: [losAngeles] }).as('losAngelesSearch');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('input[aria-label="Search cities"]').type('Los Angeles');
    cy.wait('@losAngelesSearch');
    cy.contains('.results button', 'Los Angeles').click();
    cy.wait('@evening');
    cy.wait('@uv');
    cy.get('h1').should('have.text', 'Los Angeles');
    cy.get('.timezone-label').should('contain.text', 'Pacific Standard Time (UTC−08:00)');
    cy.get('footer').should('contain.text', '2026');
    cy.get('input[type="date"]').should('have.value', '2026-12-31');
    cy.get('.city-clock time').should('have.attr', 'aria-label').and('contain', 'Dec 31, 2026');
    cy.get('.clock-digits').should('have.text', '4:00:00');
  });
  it('recovers from source failures and keeps an unavailable event distinct', () => {
    openPlanner();
    cy.intercept('GET', '/api/evening?*', {
      statusCode: 502,
      body: { error: 'USNO is temporarily unavailable.' },
    });
    cy.get('[aria-label="Next evening"]').click();
    cy.get('[role="alert"]').should('contain.text', 'We couldn’t load evening times');
    cy.title().should('eq', 'Gloam');
    cy.intercept('GET', '/api/evening?*', {
      ...eveningForDate('2026-09-14'),
      events: eveningForDate('2026-09-14').events.map((event) =>
        event.kind === 'astronomical' ? { ...event, at: null, status: 'unavailable' } : event,
      ),
    });
    cy.contains('button', 'Try again').click();
    cy.get('[aria-label="Solar events"]').should('be.visible');
    cy.get('.event').last().find('.missing').should('have.text', 'Unavailable');
    cy.get('.event .digits').should('have.length', 3);
    cy.get('.event').last().should('not.contain.text', 'Doesn’t occur');
  });
  it('retries a failed city search without changing or retyping the query', () => {
    openPlanner();
    // Use a distinct valid query so an earlier search's HTTP cache cannot bypass interception.
    const query = 'London, GB';
    const queries: string[] = [];
    cy.intercept('GET', '/api/cities?q=*', (req) => {
      queries.push(new URL(req.url).searchParams.get('q')!);
      req.reply(
        queries.length === 1
          ? { statusCode: 503, body: { error: 'Search temporarily unavailable' } }
          : {
              body: {
                cities: [
                  {
                    ...city,
                    id: 2643743,
                    name: 'London',
                    region: 'England',
                    country: 'United Kingdom',
                    countryCode: 'GB',
                    latitude: 51.50853,
                    longitude: -0.12574,
                    timezone: 'Europe/London',
                  },
                ],
              },
            },
      );
    }).as('citySearch');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('[aria-label="Search cities"]').type(query, { delay: 0 });
    cy.wait('@citySearch').its('response.statusCode').should('eq', 503);
    cy.get('.results [role="alert"]').should('contain.text', 'We couldn’t search for cities');
    cy.get('[aria-label="Search cities"]').should('have.value', query);
    cy.get('.search-retry').click();
    cy.wait('@citySearch').its('response.statusCode').should('eq', 200);
    cy.get('.results [role="alert"]').should('not.exist');
    cy.get('[aria-label="Search cities"]').should('have.value', query);
    cy.then(() => expect(queries).to.deep.equal([query, query]));
    cy.contains('.results button', 'England, United Kingdom').click();
    cy.get('h1').should('have.text', 'London');
    cy.get('.dialog-content').should('not.exist');
  });
  it('keeps explicit city choice when an earlier IP lookup finishes late', () => {
    cy.clock(Date.UTC(2026, 8, 13, 18), ['Date', 'setInterval', 'clearInterval']);
    cy.intercept('https://ipwho.is/**', {
      delay: 4000,
      body: {
        success: true,
        city: 'Paris',
        region: 'Île-de-France',
        country: 'France',
        country_code: 'FR',
        latitude: 48.85,
        longitude: 2.35,
        timezone: { id: 'Europe/Paris' },
      },
    }).as('location');
    cy.intercept('GET', '/api/evening?*', evening);
    cy.intercept('GET', '/api/uv?*', forecast);
    cy.visit('/', {
      onBeforeLoad(win) {
        win.localStorage.clear();
      },
    });
    cy.get('[aria-label="Choose a city"]').first().click();
    cy.get('input[aria-label="Search cities"]').type('New York');
    cy.contains('.results button', 'New York City').click();
    cy.get('h1').should('have.text', 'New York City');
    cy.wait('@location');
    cy.get('h1').should('have.text', 'New York City');
    cy.get('[aria-label="Solar events"]').should('be.visible');
  });
  it('reflows at 200 percent text size on a narrow phone', () => {
    cy.viewport(320, 844);
    openPlanner();
    cy.document().then((doc) => {
      doc.documentElement.style.fontSize = '200%';
    });
    cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.lte(320));
    cy.get('.event').should('have.length', 4);
  });
  it('shows every hourly UV value once without a selected-hour control', () => {
    openPlanner();
    cy.get('ul.uv-hours').children('li').should('have.length', 8);
    cy.get('.uv-hours .hour-value').should((values) => {
      expect(
        [...values].map((value) => value.textContent?.replace(/^\s*UV Index\s*/, '').trim()),
      ).to.deep.equal(['2.4', '0.9', '0.2', '0.0', '0.0', '0.0', '0.0', '0.0']);
    });
    cy.get('.uv-hours .hour-time').should('have.length', 8);
    cy.get('.uv-hours .hour-time')
      .first()
      .invoke('text')
      .should('match', /4\s*PM/);
    cy.get('.uv-hours .hour-time')
      .last()
      .invoke('text')
      .should('match', /11\s*PM/);
    cy.get('.uv-hours button, .uv-hours [aria-pressed], .uv-value').should('not.exist');
    cy.injectAxe();
    cy.checkA11y(undefined, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    });
  });
  it('retries unavailable UV data and distinguishes a missing hour from zero', () => {
    openPlanner();
    cy.intercept('GET', '/api/uv?*', { ...forecast, status: 'unavailable', points: [] });
    cy.get('[aria-label="Next evening"]').click();
    cy.contains('.uv-card h3', 'Forecast unavailable').should('be.visible');
    cy.get('.uv-hours, .hour-value').should('not.exist');
    cy.intercept('GET', '/api/uv?*', {
      ...forecast,
      status: 'partial',
      points: forecast.points.map((point, index) =>
        index === 1 ? { ...point, index: null } : point,
      ),
    });
    cy.get('[aria-label="Retry UV forecast"]').click();
    cy.get('.uv-hours .hour-value').should('have.length', 8);
    cy.get('.uv-hours .hour-value').eq(1).should('contain.text', 'unavailable');
    cy.get('.uv-hours .hour-value').eq(1).find('[aria-hidden="true"]').should('have.text', '—');
    cy.get('.uv-hours .hour-value')
      .eq(3)
      .invoke('text')
      .should('match', /UV Index\s*0\.0/);
    cy.contains('Some hours are unavailable.').should('be.visible');
  });
  it('removes dialogs and restores focus after closing', () => {
    openPlanner();
    cy.get('[aria-label^="Change city"]').click();
    cy.get('[aria-label="Close city search"]').click();
    cy.get('.dialog-content').should('not.exist');
    cy.focused().should('have.attr', 'aria-label', 'Change city, currently New York City');
    cy.get('[aria-label^="Change city"]').click();
    cy.get('[aria-label="Search cities"]').type('{esc}');
    cy.get('.dialog-content').should('not.exist');
    cy.get('.dialog-overlay').should('not.exist');
    cy.contains('button', 'About the data').click();
    cy.get('[aria-label="Close about the data"]').click();
    cy.get('.dialog-content').should('not.exist');
    cy.get('.dialog-overlay').should('not.exist');
    cy.focused().should('contain.text', 'About the data');
    cy.get('body').should('not.have.css', 'overflow', 'hidden');
  });
  for (const width of [320, 768, 1440]) {
    it(`aligns labels and times within each row at ${width}px with mixed date offsets`, () => {
      cy.viewport(width, 1000);
      // These fixture events span local midnight in the selected city without a zone override.
      openPlanner({
        now: Date.UTC(2026, 4, 1, 18),
        selectedCity: stockholm,
        template: {
          ...evening,
          date: '2026-05-01',
          events: evening.events.map((event, index) => ({
            ...event,
            at: [
              '2026-05-01T18:40:00.000Z',
              '2026-05-01T19:31:00.000Z',
              '2026-05-01T20:41:00.000Z',
              '2026-05-01T22:09:00.000Z',
            ][index],
          })),
        },
      });
      cy.get('.event').first().find('.offset').should('not.exist');
      cy.get('.event').last().find('.offset').should('contain.text', 'Next day');
      cy.get('.events .event').should((events) => {
        const labels = [...events].map((event) => event.querySelector('.event-label')!);
        const times = [...events].map((event) => event.querySelector('.boundary-time')!);
        const lefts = labels.map((label) => label.getBoundingClientRect().left);
        const rights = times.map((time) => time.getBoundingClientRect().right);
        expect(Math.max(...lefts) - Math.min(...lefts), 'shared label left edge').to.be.lte(1);
        expect(Math.max(...rights) - Math.min(...rights), 'shared time right edge').to.be.lte(1);
        if (width > 640) {
          const descriptionGaps = [...events].map(
            (event, index) =>
              event.querySelector('.event-description')!.getBoundingClientRect().top -
              labels[index].getBoundingClientRect().bottom,
          );
          expect(
            Math.max(...descriptionGaps) - Math.min(...descriptionGaps),
            'equal title-to-description spacing with and without date offsets',
          ).to.be.lte(1);
        }
        [...events].forEach((event, index) => {
          const timeDigits = event.querySelector('.boundary-time .digits')!;
          const difference = Math.abs(
            firstLineBaseline(labels[index]) - firstLineBaseline(timeDigits),
          );
          expect(difference, `row ${index + 1} label and time first-line baseline`).to.be.lte(1.5);
        });
      });
    });
  }
  for (const width of [320, 375, 390, 430, 640, 641, 768, 1024, 1440, 2560]) {
    it(`is usable without horizontal overflow at ${width}px`, () => {
      cy.viewport(width, width < 600 ? 844 : 1000);
      openPlanner({ selectedCity: width === 320 ? sydney : city });
      if (width === 320) {
        cy.get('.timezone-label')
          .should('contain.text', 'Australian Eastern Standard Time (UTC+10:00)')
          .and(($label) => {
            const label = $label[0];
            const text = label.querySelector('span')!;
            const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
            expect(
              text.getBoundingClientRect().height,
              'long name wraps onto multiple lines',
            ).to.be.at.least(lineHeight * 2 - 1);
            expect(label.scrollWidth, 'full name fits inside the label').to.be.lte(
              label.clientWidth,
            );
          });
      }
      cy.document().then((doc) => expect(doc.documentElement.scrollWidth).to.be.lte(width));
      cy.get('.event')
        .should('have.length', 4)
        .each((element) => expect(element[0].getBoundingClientRect().width).to.be.greaterThan(100));
      cy.get('.events').then((element) =>
        expect(getComputedStyle(element[0]).gridTemplateColumns.split(' ').length).to.equal(1),
      );
      cy.injectAxe();
      cy.checkA11y(undefined, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
      });
      cy.screenshot(`gloam-${width}`, { capture: 'fullPage' });
    });
  }
});
