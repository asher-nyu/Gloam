import type { CyHttpMessages } from 'cypress/types/net-stubbing';

/** Fictional annual tables used only by browser tests, never by the application. */
export interface EveningFixture {
  events: { kind: string; at: string | null; status: string }[];
}

export const usnoAnnualUrl = 'https://aa.usno.navy.mil/calculated/rstt/year?*';
export const usnoHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

const taskKinds: Record<string, string> = {
  '0': 'sunset',
  '2': 'civil',
  '3': 'nautical',
  '4': 'astronomical',
};

export function annualTableHtml(year: number, setting: string, rising = '1200'): string {
  const rows = Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const cells = Array.from({ length: 12 }, (_, month) => {
      const valid = new Date(Date.UTC(year, month, day)).getUTCMonth() === month;
      return valid ? `${rising} ${setting}  ` : ' '.repeat(11);
    });
    return `${String(day).padStart(2, '0')}  ${cells.join('')}`;
  });
  return `<html><body><pre>Fictional USNO-format fixture\nUniversal Time\n${rows.join('\n')}</pre></body></html>`;
}

export function replyWithAnnualTable(
  request: CyHttpMessages.IncomingHttpRequest,
  template: EveningFixture,
) {
  const query = new URL(request.url).searchParams;
  const event = template.events.find((event) => event.kind === taskKinds[query.get('task')!]);
  if (!event || event.status === 'unavailable') {
    request.reply({ statusCode: 502, headers: usnoHeaders, body: 'Source unavailable' });
    return;
  }
  const clock = event.at ? event.at.slice(11, 16).replace(':', '') : '----';
  request.reply({
    statusCode: 200,
    headers: usnoHeaders,
    body: annualTableHtml(Number(query.get('year')), clock),
  });
}

export function interceptUsno(
  template: EveningFixture,
  alias = 'evening',
  cityScenarios: Record<string, EveningFixture> = {},
) {
  cy.intercept('GET', usnoAnnualUrl, (request) => {
    const latitude = new URL(request.url).searchParams.get('lat')!;
    replyWithAnnualTable(request, cityScenarios[latitude] ?? template);
  }).as(alias);
}

export function waitForEvening(alias = 'evening', count = 4) {
  cy.wait(Array.from({ length: count }, () => `@${alias}` as const));
  cy.get('.evening-card .event').should('have.length', 4);
}
