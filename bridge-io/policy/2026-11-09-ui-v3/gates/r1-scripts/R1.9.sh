#!/bin/sh
EV='C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3'
BASE=4c65ead4f46cf97eecffd73149a57056e505568c
HEAD=7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62
GATE=R1.9
cd /c/Users/Dragonfly/Downloads/warsha-wt/v3/r1 || exit 99
git diff $BASE..HEAD -- crates | grep -nE "^\+.*(#\[ignore\]|todo!\(|unimplemented!\()"
