import {
  type QueryBuilder,
  type QueryExpr,
  type QuerySpec,
  queryExprBrand,
} from '../shared/index.js';

export type { QueryBuilder, QueryExpr, QuerySpec } from '../shared/index.js';

interface InternalQueryExpr extends QueryExpr {
  readonly words: readonly string[];
}

function makeExpr(words: readonly string[]): QueryExpr {
  const value: InternalQueryExpr = { [queryExprBrand]: true, words };
  return value;
}

export function compileQuery(expression: QueryExpr): readonly string[] {
  return (expression as InternalQueryExpr).words;
}

export class QueryBuilderImpl<K extends string> implements QueryBuilder<K> {
  eq(name: K, value: string): QueryExpr {
    return makeExpr([`?${name}=${value}`]);
  }

  lt(name: K, value: string): QueryExpr {
    return makeExpr([`?<${name}=${value}`]);
  }

  gt(name: K, value: string): QueryExpr {
    return makeExpr([`?>${name}=${value}`]);
  }

  exists(name: K): QueryExpr {
    return makeExpr([`?${name}`]);
  }

  absent(name: K): QueryExpr {
    return makeExpr([`?-${name}`]);
  }

  not(expression: QueryExpr): QueryExpr {
    return makeExpr([...compileQuery(expression), '?#!']);
  }

  and(...expressions: readonly QueryExpr[]): QueryExpr {
    return combine('?#&', expressions);
  }

  or(...expressions: readonly QueryExpr[]): QueryExpr {
    return combine('?#|', expressions);
  }

  raw(words: readonly string[]): QueryExpr {
    if (words.length === 0) throw new TypeError('Raw query cannot be empty');
    for (const word of words) {
      if (!word.startsWith('?')) {
        throw new TypeError(`Invalid query word: ${word}`);
      }
    }
    return makeExpr([...words]);
  }
}

function combine(
  operator: '?#&' | '?#|',
  expressions: readonly QueryExpr[],
): QueryExpr {
  if (expressions.length === 0) {
    throw new TypeError('A query group needs at least one expression');
  }
  if (expressions.length === 1) return expressions[0] as QueryExpr;
  const words: string[] = [];
  for (const expression of expressions) words.push(...compileQuery(expression));
  for (let index = 1; index < expressions.length; index += 1) {
    words.push(operator);
  }
  return makeExpr(words);
}

export function compileQuerySpec<K extends string>(
  spec: QuerySpec<K> | undefined,
): readonly string[] {
  if (spec === undefined) return [];
  if (typeof spec === 'function') {
    return compileQuery(spec(new QueryBuilderImpl<K>()));
  }
  for (const word of spec) {
    if (!word.startsWith('?')) {
      throw new TypeError(`Invalid query word: ${word}`);
    }
  }
  return spec;
}
