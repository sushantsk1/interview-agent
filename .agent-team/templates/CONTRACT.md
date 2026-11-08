# Frontend/backend contract

Owner: backend after initial agreement. Status: not agreed. Version: 0.

## Interface and environment

Describe transport, base URL or shared entry points, environment variables,
local startup, and frontend origin where applicable. Mark not applicable with a
reason for projects without a frontend/backend boundary.

## Operations

For each endpoint or call: method/name, path, purpose, request fields, validation,
response fields, status codes, and concrete success and failure examples.

## Identity and errors

Document authentication, authorization, error shape, and relevant retry behavior.

## Data conventions

Document identifiers, dates/timezones, nullable fields, pagination, and storage
assumptions relevant to consumers.

## Agreement and changes

Record frontend, backend, tester acknowledgments and the lead's decision. For
each accepted change, increment the version, record compatibility impact, notify
consumers, and record acknowledgments before incompatible work proceeds.
