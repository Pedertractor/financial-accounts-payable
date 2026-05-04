import { Link, useLocation } from 'react-router';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar';

export type NavMainItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  isActive?: boolean;
  soon?: boolean;
  items?: { title: string; url: string }[];
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const location = useLocation();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Plataforma</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          if (item.soon) {
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton disabled tooltip={item.title}>
                  <item.icon className='size-4' />
                  <span>{item.title}</span>
                  <Badge
                    variant='secondary'
                    className='ml-auto h-5 px-1.5 text-[0.65rem] font-normal'
                  >
                    em breve
                  </Badge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          }

          if (item.items && item.items.length > 0) {
            return (
              <Collapsible
                key={item.title}
                defaultOpen={item.isActive}
                className='group/collapsible'
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger
                  render={<SidebarMenuButton tooltip={item.title} />}
                >
                  <item.icon className='size-4' />
                  <span>{item.title}</span>
                  <ChevronRight className='ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90' />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {item.items.map((sub) => (
                      <SidebarMenuSubItem key={sub.title}>
                        <SidebarMenuSubButton
                          isActive={location.pathname === sub.url}
                          render={<Link to={sub.url} />}
                        >
                          <span>{sub.title}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            );
          }

          return (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                isActive={location.pathname === item.url}
                render={<Link to={item.url} />}
                tooltip={item.title}
              >
                <item.icon className='size-4' />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
