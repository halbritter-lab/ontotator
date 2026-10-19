import { expect, it } from 'vitest';
import { parseRoute, routeHref } from '../src/app/router';

it('roundtrips opaque case and query identities, including explicit empty selections', () => {
  for (const annotations of [undefined, '', '["own","a/text %2F #é"]']) {
    const route = { name: 'projectCase' as const, key: 'p/ %', caseId: 'EN 1/7 #é', variant: 'a/annotation-versions/own/y', ...(annotations === undefined ? {} : { annotations }) };
    expect(parseRoute(routeHref(route))).toEqual(route);
  }
  expect(parseRoute('#/projects/p/cases/%ZZ').name).toBe('notFound');
});

it('roundtrips a filtered Documents return without allowing an unrelated return destination', () => {
  const route = { name: 'projectCase' as const, key: 'p', caseId: 'case', variant: 'old',
    documents: { language: 'de', q: 'GSC +/#', status: 'submitted', origin: 'correction' } };
  expect(parseRoute(routeHref(route))).toEqual(route);
  const parsed = parseRoute('#/projects/p/cases/case?back=https%3A%2F%2Foutside.test');
  expect(parsed).toEqual({ name: 'projectCase', key: 'p', caseId: 'case' });
});
