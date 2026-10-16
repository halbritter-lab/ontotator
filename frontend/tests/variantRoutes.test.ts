import { expect, it } from 'vitest';
import { parseRoute, routeHref } from '../src/app/router';

it('roundtrips opaque case and query identities, including explicit empty selections', () => {
  for (const annotations of [undefined, '', '["own","a/text %2F #é"]']) {
    const route = { name: 'projectCase' as const, key: 'p/ %', caseId: 'EN 1/7 #é', variant: 'a/annotation-versions/own/y', ...(annotations === undefined ? {} : { annotations }) };
    expect(parseRoute(routeHref(route))).toEqual(route);
  }
  expect(parseRoute('#/projects/p/cases/%ZZ').name).toBe('notFound');
});
