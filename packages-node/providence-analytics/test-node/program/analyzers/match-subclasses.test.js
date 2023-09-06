const { expect } = require('chai');
const { providence } = require('../../../src/program/providence.js');
const { QueryService } = require('../../../src/program/services/QueryService.js');
const { InputDataService } = require('../../../src/program/services/InputDataService.js');
const {
  mockTargetAndReferenceProject,
  restoreMockedProjects,
} = require('../../../test-helpers/mock-project-helpers.js');
const {
  mockWriteToJson,
  restoreWriteToJson,
} = require('../../../test-helpers/mock-report-service-helpers.js');
const {
  suppressNonCriticalLogs,
  restoreSuppressNonCriticalLogs,
} = require('../../../test-helpers/mock-log-service-helpers.js');

// 1. Reference input data
const referenceProject = {
  path: '/importing/target/project/node_modules/exporting-ref-project',
  name: 'exporting-ref-project',
  files: [
    // This file contains all 'original' exported definitions
    {
      file: './ref-src/core.js',
      code: `
        // named specifier
        export class RefClass extends HTMLElement {};

        // default specifier
        export default class OtherClass {};
      `,
    },
    // This file is used to test file system 'resolvements' -> importing repos using
    // `import 'exporting-ref-project/ref-src/folder'` should be pointed to this index.js file
    {
      file: './index.js',
      code: `
        export { RefClass as RefRenamedClass } from './ref-src/core.js';

        // re-exported default specifier
        import refConstImported from './ref-src/core.js';
        export default refConstImported;

        export const Mixin = superclass => class MyMixin extends superclass {}
      `,
    },
  ],
};

const searchTargetProject = {
  path: '/importing/target/project',
  name: 'importing-target-project',
  files: [
    {
      file: './target-src/indirect-imports.js',
      // Indirect (via project root) imports
      code: `
      // renamed import (indirect, needs transitivity check)
      import { RefRenamedClass } from 'exporting-ref-project';
      import defaultExport from 'exporting-ref-project';

      class ExtendRefRenamedClass extends RefRenamedClass {}
    `,
    },
    {
      file: './target-src/direct-imports.js',
      code: `
      // a direct named import
      import { RefClass } from 'exporting-ref-project/ref-src/core.js';

      // a direct default import
      import RefDefault from 'exporting-ref-project';

      // a direct named mixin
      import { Mixin } from 'exporting-ref-project';

      // Non match
      import { ForeignMixin } from 'unknow-project';

      class ExtendRefClass extends RefClass {}
      class ExtendRefDefault extends RefDefault {}
      class ExtendRefClassWithMixin extends ForeignMixin(Mixin(RefClass)) {}
    `,
    },
  ],
};

const matchSubclassesQueryConfig = QueryService.getQueryConfigFromAnalyzer('match-subclasses');
const _providenceCfg = {
  targetProjectPaths: [searchTargetProject.path],
  referenceProjectPaths: [referenceProject.path],
};

// 2. Extracted specifiers (by find-exports analyzer)
const expectedExportIdsIndirect = ['RefRenamedClass::./index.js::exporting-ref-project'];

const expectedExportIdsDirect = [
  // ids should be unique across multiple projects
  // Not in scope: version number of a project.
  'RefClass::./ref-src/core.js::exporting-ref-project',
  '[default]::./index.js::exporting-ref-project',
  'Mixin::./index.js::exporting-ref-project',
];
// eslint-disable-next-line no-unused-vars
const expectedExportIds = [...expectedExportIdsIndirect, ...expectedExportIdsDirect];

// 3. The AnalyzerQueryResult generated by "match-subclasses"
// eslint-disable-next-line no-unused-vars
const expectedMatchesOutput = [
  {
    exportSpecifier: {
      name: 'RefClass',
      // name under which it is registered in npm ("name" attr in package.json)
      project: 'exporting-ref-project',
      filePath: './ref-src/core.js',
      id: 'RefClass::./ref-src/core.js::exporting-ref-project',

      // TODO: next step => identify transitive relations and add inside
      // most likely via post processor
    },
    // All the matched targets (files importing the specifier), ordered per project
    matchesPerProject: [
      {
        project: 'importing-target-project',
        files: [
          { file: './target-src/indirect-imports.js', identifier: 'ExtendedRefClass' },
          // ...
        ],
      },
      // ...
    ],
  },
];

// eslint-disable-next-line no-shadow

describe('Analyzer "match-subclasses"', () => {
  const originalReferenceProjectPaths = InputDataService.referenceProjectPaths;
  const queryResults = [];
  const cacheDisabledQInitialValue = QueryService.cacheDisabled;
  const cacheDisabledIInitialValue = InputDataService.cacheDisabled;

  before(() => {
    QueryService.cacheDisabled = true;
    InputDataService.cacheDisabled = true;
    suppressNonCriticalLogs();
  });

  after(() => {
    QueryService.cacheDisabled = cacheDisabledQInitialValue;
    InputDataService.cacheDisabled = cacheDisabledIInitialValue;
    restoreSuppressNonCriticalLogs();
  });

  beforeEach(() => {
    InputDataService.cacheDisabled = true;
    InputDataService.referenceProjectPaths = [];
    mockWriteToJson(queryResults);
  });

  afterEach(() => {
    InputDataService.referenceProjectPaths = originalReferenceProjectPaths;
    restoreWriteToJson(queryResults);
    restoreMockedProjects();
  });

  describe('Extracting exports', () => {
    it(`identifies all indirect export specifiers consumed by "importing-target-project"`, async () => {
      mockTargetAndReferenceProject(searchTargetProject, referenceProject);
      await providence(matchSubclassesQueryConfig, _providenceCfg);
      const queryResult = queryResults[0];
      expectedExportIdsIndirect.forEach(indirectId => {
        expect(
          queryResult.queryOutput.find(
            exportMatchResult => exportMatchResult.exportSpecifier.id === indirectId,
          ),
        ).not.to.equal(undefined, `id '${indirectId}' not found`);
      });
    });

    it(`identifies all direct export specifiers consumed by "importing-target-project"`, async () => {
      mockTargetAndReferenceProject(searchTargetProject, referenceProject);
      await providence(matchSubclassesQueryConfig, _providenceCfg);
      const queryResult = queryResults[0];
      expectedExportIdsDirect.forEach(directId => {
        expect(
          queryResult.queryOutput.find(
            exportMatchResult => exportMatchResult.exportSpecifier.id === directId,
          ),
        ).not.to.equal(undefined, `id '${directId}' not found`);
      });
    });
  });

  describe('Matching', () => {
    // TODO: because we intoduced an object in match-classes, we find duplicate entries in
    // our result set cretaed in macth-subclasses. Fix there...
    it.skip(`produces a list of all matches, sorted by project`, async () => {
      function testMatchedEntry(targetExportedId, queryResult, importedByFiles = []) {
        const matchedEntry = queryResult.queryOutput.find(
          r => r.exportSpecifier.id === targetExportedId,
        );

        const [name, filePath, project] = targetExportedId.split('::');
        expect(matchedEntry.exportSpecifier).to.eql({
          name,
          filePath,
          project,
          id: targetExportedId,
        });
        expect(matchedEntry.matchesPerProject[0].project).to.equal('importing-target-project');
        expect(matchedEntry.matchesPerProject[0].files).to.eql(importedByFiles);
      }

      mockTargetAndReferenceProject(searchTargetProject, referenceProject);
      await providence(matchSubclassesQueryConfig, _providenceCfg);
      const queryResult = queryResults[0];

      expectedExportIdsDirect.forEach(targetId => {
        testMatchedEntry(targetId, queryResult, [
          // TODO: 'identifier' needs to be the exported name of extending class
          {
            identifier: targetId.split('::')[0],
            file: './target-src/direct-imports.js',
            memberOverrides: undefined,
          },
        ]);
      });

      expectedExportIdsIndirect.forEach(targetId => {
        testMatchedEntry(targetId, queryResult, [
          // TODO: 'identifier' needs to be the exported name of extending class
          { identifier: targetId.split('::')[0], file: './target-src/indirect-imports.js' },
        ]);
      });
    });
  });
});
