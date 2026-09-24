'use client';
/**
 * Projects (plan §4): create a project, save the current viewpoint into it, reopen a viewpoint.
 * Accessible without leaving the current location. Requires an account; the paywall explains limits.
 */
import { useState } from 'react';
import type { SceneState } from '@lightmap/scene';
import { horizontalFovDeg } from '@lightmap/scene';
import { isScenarioId } from '@lightmap/weather';
import { usePlannerStore } from '@/features/planner/store';
import { useAccount } from '@/features/account/use-account';
import { useProject, useProjectMutations, useProjects } from '@/features/projects/use-projects';
import { viewpointPayload } from '@/features/projects/viewpoint-payload';
import { ApiRequestError } from '@/lib/client/api';
import type { ViewpointDto } from '@/lib/api-types';
import { Button } from '@lightmap/ui';
import { ProjectCard } from './ProjectCard';
import { SavedViewpointCard } from './SavedViewpointCard';
import { ErrorState } from './states/ErrorState';
import { EmptyState } from './states/EmptyState';
import { Paywall } from './Paywall';
import { SignInPrompt } from './AccountMenu';

export function ProjectDrawer({
  scene,
  captureThumbnail,
}: {
  scene: SceneState | null;
  captureThumbnail: () => Promise<string | null>;
}) {
  const account = useAccount();
  const projects = useProjects(account.signedIn);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const project = useProject(selectedId);
  const m = useProjectMutations();
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<{ message: string; upgradeTo?: string } | null>(null);
  const restore = usePlannerStore((s) => s.restore);
  const setPanel = usePlannerStore((s) => s.setPanel);

  if (account.isLoading)
    return <p className="text-sm text-[var(--lm-text-muted)]">Loading account…</p>;
  if (!account.signedIn)
    return (
      <SignInPrompt reason="Sign in to save viewpoints to a project and reopen them on any device." />
    );

  const projectDecision = account.can('saved_projects', {
    projectCount: projects.data?.projects.length ?? 0,
  });
  const handle = (e: unknown) =>
    setError(
      e instanceof ApiRequestError
        ? { message: e.message, ...(e.upgradeTo ? { upgradeTo: e.upgradeTo } : {}) }
        : { message: 'That did not work. Your planning selection is unchanged.' },
    );

  async function createProject() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const r = await m.create.mutateAsync({ name: newName.trim(), shootDate: newDate || null });
      setSelectedId(r.project.id);
      setNewName('');
      setNewDate('');
    } catch (e) {
      handle(e);
    }
  }

  async function saveViewpoint() {
    if (!scene || !selectedId) return;
    setError(null);
    try {
      const thumb = await captureThumbnail();
      await m.saveViewpoint.mutateAsync({
        projectId: selectedId,
        body: viewpointPayload(scene, label.trim() || scene.location.label, thumb),
      });
      setLabel('');
      void project.refetch();
    } catch (e) {
      handle(e);
    }
  }

  function open(v: ViewpointDto) {
    restore({
      location: {
        point: {
          latitude: v.latitude,
          longitude: v.longitude,
          ...(v.elevationM !== null ? { elevationM: v.elevationM } : {}),
        },
        timeZone: v.timezone,
        label: v.label,
        source: 'saved',
      },
      utc: new Date(v.selectedDatetimeUtc),
      camera: {
        eye: { latitude: v.latitude, longitude: v.longitude },
        eyeHeightM: 1.7,
        headingDeg: v.headingDeg,
        pitchDeg: v.pitchDeg,
        fovDeg: v.focalLengthEquivalentMm
          ? horizontalFovDeg(v.focalLengthEquivalentMm)
          : v.fieldOfViewDeg,
        focalLengthMm: v.focalLengthEquivalentMm,
        mode: 'viewpoint',
      },
      scenario: v.weatherScenario && isScenarioId(v.weatherScenario) ? v.weatherScenario : null,
    });
    setPanel('plan');
  }

  return (
    <div className="space-y-4" data-testid="project-drawer">
      {error ? (
        <ErrorState
          title={error.message}
          action={error.upgradeTo ? <Paywall compact reason={error.message} /> : undefined}
        />
      ) : null}
      <section aria-labelledby="lm-projects-h">
        <h3
          id="lm-projects-h"
          className="mb-2 text-xs uppercase tracking-wide text-[var(--lm-text-muted)]"
        >
          Projects
        </h3>
        {projects.isLoading ? (
          <p className="text-sm text-[var(--lm-text-muted)]">Loading…</p>
        ) : null}
        {projects.data && projects.data.projects.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body="A project is a shoot: give it a name and an optional date, then save viewpoints into it."
          />
        ) : null}
        <div className="space-y-2">
          {projects.data?.projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              selected={p.id === selectedId}
              onSelect={() => setSelectedId(p.id === selectedId ? null : p.id)}
            />
          ))}
        </div>
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void createProject();
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New project name"
            aria-label="New project name"
            maxLength={120}
            className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            data-testid="project-name"
            disabled={!projectDecision.allowed}
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            aria-label="Shoot date (optional)"
            className="h-11 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
            disabled={!projectDecision.allowed}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={!newName.trim() || m.create.isPending || !projectDecision.allowed}
            data-testid="project-create"
          >
            Create
          </Button>
        </form>
        {!projectDecision.allowed ? (
          <Paywall compact reason={projectDecision.reason ?? ''} />
        ) : null}
      </section>

      {selectedId ? (
        <section aria-labelledby="lm-viewpoints-h" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3
              id="lm-viewpoints-h"
              className="text-xs uppercase tracking-wide text-[var(--lm-text-muted)]"
            >
              Saved viewpoints
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (confirm('Delete this project and its viewpoints?')) {
                  void m.remove
                    .mutateAsync(selectedId)
                    .then(() => setSelectedId(null))
                    .catch(handle);
                }
              }}
            >
              Delete project
            </Button>
          </div>
          {scene ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void saveViewpoint();
              }}
            >
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`Label (default: ${scene.location.label.slice(0, 32)})`}
                aria-label="Viewpoint label"
                maxLength={120}
                className="h-11 flex-1 rounded-[var(--lm-radius-sm)] border border-[var(--lm-panel-border)] bg-[var(--lm-panel-raised)] px-3 text-sm focus:outline-none focus-visible:[box-shadow:var(--lm-focus)]"
                data-testid="viewpoint-label"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={m.saveViewpoint.isPending}
                data-testid="viewpoint-save"
              >
                {m.saveViewpoint.isPending ? 'Saving…' : 'Save this view'}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-[var(--lm-text-muted)]">
              Pick a location to save a viewpoint.
            </p>
          )}
          {project.data?.project.viewpoints.length === 0 ? (
            <p className="text-sm text-[var(--lm-text-muted)]">Nothing saved here yet.</p>
          ) : null}
          <div className="space-y-2">
            {project.data?.project.viewpoints.map((v) => (
              <SavedViewpointCard
                key={v.id}
                viewpoint={v}
                onOpen={() => open(v)}
                onDelete={() =>
                  void m.removeViewpoint
                    .mutateAsync(v.id)
                    .then(() => project.refetch())
                    .catch(handle)
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
