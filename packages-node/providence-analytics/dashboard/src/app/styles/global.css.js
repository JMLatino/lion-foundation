// eslint-disable-next-line import/no-extraneous-dependencies
import { css } from 'lit';

export const global = css`
  :host {
    font-family: 'Roboto Condensed', sans-serif;
    --primary-color: cornflowerblue;
  }

  * {
    box-sizing: border-box;
  }

  *:focus {
    outline: 2px dotted gray;
  }
`;
