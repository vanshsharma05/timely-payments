// @vitest-environment jsdom
/**
 * Team & access and Message templates, in the book's chrome: the one badge
 * for roles, scope and rights, the delete control that asks in the app,
 * the company profile on its own tab, and a template list that opens on the
 * name.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

import TeamView from '../components/TeamView';
import TemplatesView from '../components/TemplatesView';
import { User, UserRole, DataVisibility, DEFAULT_ROLE_PERMISSIONS, DEFAULT_COMPANY_PROFILE, Template } from '../types';

afterEach(cleanup);

const users: User[] = [
    { id: 'ADMIN', name: 'Ankur', role: UserRole.Admin, email: 'ankur@co.in', permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Admin], dataVisibility: DataVisibility.All },
    { id: 'RAVI', name: 'Ravi', role: UserRole.CRM, email: 'ravi@co.in', permissions: { ...DEFAULT_ROLE_PERMISSIONS[UserRole.CRM], canDeleteCustomer: false, canExportData: false }, dataVisibility: DataVisibility.AssignedOnly, assignedCrms: ['RAVI', 'SOUTH'] },
    { id: 'MEERA', name: 'Meera', role: UserRole.Viewer, permissions: DEFAULT_ROLE_PERMISSIONS[UserRole.Viewer], dataVisibility: DataVisibility.All },
];

const teamProps = () => ({
    users,
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    companyProfile: { ...DEFAULT_COMPANY_PROFILE, name: 'Shori Chemicals' },
    onSaveCompanyProfile: vi.fn(),
});

describe('Team & access', () => {
    it('lists each person with their role, what they see and what they may do', () => {
        render(<TeamView {...teamProps()} />);
        const table = screen.getByRole('table');
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(3);

        const admin = rows[0];
        expect(within(admin).getByText('Admin')).toBeTruthy();
        expect(within(admin).getByText('All accounts')).toBeTruthy();
        expect(within(admin).getByText('Everything')).toBeTruthy();

        const ravi = rows[1];
        expect(within(ravi).getByText('CRM')).toBeTruthy();
        expect(within(ravi).getAllByText('RAVI').length).toBe(2); // the code, and the portfolio it owns
        expect(within(ravi).getByText('SOUTH')).toBeTruthy();
        expect(within(ravi).getByText('Follow-ups')).toBeTruthy();
        expect(within(ravi).queryByText('Delete customers')).toBeNull();

        const meera = rows[2];
        expect(within(meera).getByText('Viewer')).toBeTruthy();
        expect(within(meera).getByText('Read only')).toBeTruthy();
    });

    it('never offers to remove the Admin, and hands the others to the app to ask', () => {
        const p = teamProps();
        render(<TeamView {...p} />);
        expect(screen.queryByRole('button', { name: 'Remove Ankur' })).toBeNull();
        fireEvent.click(screen.getAllByRole('button', { name: 'Remove Ravi' })[0]);
        expect(p.onRemove).toHaveBeenCalledWith('RAVI');
        fireEvent.click(screen.getAllByRole('button', { name: /Edit rights/ })[0]);
        expect(p.onEdit).toHaveBeenCalledWith(users[0]);
        fireEvent.click(screen.getByRole('button', { name: /Add a team member/ }));
        expect(p.onAdd).toHaveBeenCalled();
    });

    it('keeps the company profile on its own tab and saves it as a whole', () => {
        const p = teamProps();
        render(<TeamView {...p} />);
        const tabs = screen.getByRole('tablist', { name: /Team members or company profile/ });
        expect(within(tabs).getByRole('tab', { name: /Team members/ }).getAttribute('aria-selected')).toBe('true');
        fireEvent.click(within(tabs).getByRole('tab', { name: 'Company profile' }));
        expect(screen.queryByRole('table')).toBeNull();
        const name = screen.getByLabelText(/Company name/) as HTMLInputElement;
        expect(name.value).toBe('Shori Chemicals');
        fireEvent.change(screen.getByLabelText('GSTIN'), { target: { value: '07abcde1234f1z5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save company profile' }));
        expect(p.onSaveCompanyProfile).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shori Chemicals', gstin: '07ABCDE1234F1Z5' }));
        expect(screen.getByRole('status').textContent).toMatch(/Saved/);
    });
});

const templates: Template[] = [
    { id: 't1', name: 'Gentle reminder', content: 'Dear {{name}},\nyour balance of {{amount}} is due.' },
    { id: 't2', name: 'Final notice', content: '' },
];

describe('Message templates', () => {
    it('opens a template from its name and shows its first line', () => {
        const onEdit = vi.fn(); const onRemove = vi.fn();
        render(<TemplatesView templates={templates} onAdd={vi.fn()} onEdit={onEdit} onRemove={onRemove} />);
        expect(screen.getByText('Dear {{name}},')).toBeTruthy();
        expect(screen.getByText('No wording yet')).toBeTruthy();
        fireEvent.click(screen.getAllByTitle('Open this template')[0]);
        expect(onEdit).toHaveBeenCalledWith(templates[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Delete template Final notice' }));
        expect(onRemove).toHaveBeenCalledWith('t2');
    });

    it('says so when there are none, with the one thing to do', () => {
        const onAdd = vi.fn();
        render(<TemplatesView templates={[]} onAdd={onAdd} onEdit={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByText('No templates yet')).toBeTruthy();
        fireEvent.click(screen.getAllByRole('button', { name: 'New template' })[1]);
        expect(onAdd).toHaveBeenCalled();
    });
});
