import TestEnvironment from '@jest/environment-jsdom-abstract';
import * as jsdom from 'jsdom';

export default class BrowserEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context, jsdom);
  }
}
